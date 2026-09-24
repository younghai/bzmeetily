// live_pcm.rs
//
// Webview-driven live interpretation: captures microphone and/or system audio
// through the existing recording pipeline (adaptive mixing, device hot-swap,
// permission handling) and streams the raw mixed PCM to the webview instead of
// running the in-process Rust transcription path.
//
// The webview then runs the SAME live chunker + ASR/translation queues as the
// localhost web UI (contextual utterance revisions, bounded ordered upload
// queue, cancel/retry), so the app and the web behave identically.

use std::sync::Mutex;
use std::time::Instant;

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::task::JoinHandle;

use super::recording_commands::LiveInterpretationSource;
use super::recording_manager::RecordingManager;
use super::AudioChunk;
use crate::local_runtime;

struct LivePcmSession {
    manager: RecordingManager,
    forward_task: JoinHandle<()>,
    transcription_drain_task: JoinHandle<()>,
    started_at: Instant,
}

static LIVE_PCM: Mutex<Option<LivePcmSession>> = Mutex::new(None);

const LIVE_PCM_CHANNEL_CAPACITY: usize = 8;

fn live_pcm_channel() -> (
    tokio::sync::mpsc::Sender<AudioChunk>,
    tokio::sync::mpsc::Receiver<AudioChunk>,
) {
    tokio::sync::mpsc::channel(LIVE_PCM_CHANNEL_CAPACITY)
}

pub(crate) fn is_active() -> bool {
    LIVE_PCM.lock().unwrap().is_some()
}

#[derive(Debug, Deserialize)]
pub struct LivePcmArgs {
    pub mic_device_name: Option<String>,
    pub system_device_name: Option<String>,
    pub source: LiveInterpretationSource,
}

#[derive(Debug, Serialize, Clone)]
struct PcmEvent<'a> {
    data: &'a str,
    sample_rate: u32,
    level: f32,
}

/// Start streaming mixed PCM to the webview. Does NOT start Rust-side ASR;
/// the webview transcribes via the bundled whisper-server and translates via
/// Ollama through the meetily-server HTTP API.
pub async fn start_live_pcm_stream<R: Runtime>(
    app: AppHandle<R>,
    args: LivePcmArgs,
) -> Result<(), String> {
    let engine_lifecycle_guard = super::common::acquire_engine_lifecycle_lock().await;

    {
        let guard = LIVE_PCM.lock().unwrap();
        if guard.is_some() {
            return Err("PCM stream already in progress".to_string());
        }
    }
    if super::recording_commands::recording_in_progress() {
        return Err("Recording already in progress".to_string());
    }

    app.emit("recording-starting", serde_json::json!({
        "message": "Live interpretation initialization started",
        "live_interpretation": true,
        "pcm_stream": true,
    })).map_err(|e| e.to_string())?;

    let use_microphone = matches!(
        args.source,
        LiveInterpretationSource::Microphone | LiveInterpretationSource::Both
    );
    let use_system = matches!(
        args.source,
        LiveInterpretationSource::System | LiveInterpretationSource::Both
    );

    let system_device = if use_system {
        super::recording_commands::resolve_system_or_default(args.system_device_name.as_deref())
    } else {
        None
    };

    #[cfg(target_os = "macos")]
    super::recording_commands::prepare_audio_for_recording(system_device.as_deref(), use_microphone).await?;

    #[cfg(not(target_os = "macos"))]
    let _ = use_microphone;

    #[cfg(target_os = "macos")]
    let microphone_device = if use_microphone {
        super::recording_commands::resolve_mic_or_default(&app, args.mic_device_name.as_deref())
    } else {
        None
    };
    #[cfg(not(target_os = "macos"))]
    let microphone_device = if use_microphone {
        super::recording_commands::resolve_mic_or_default(&app, args.mic_device_name.as_deref())
    } else {
        None
    };

    if microphone_device.is_none() && system_device.is_none() {
        return Err("사용 가능한 오디오 입력이 없습니다. 마이크 권한과 입력 장치를 확인하세요.".to_string());
    }

    let mut manager = RecordingManager::new_with_persistence(false);
    let app_for_error = app.clone();
    manager.set_error_callback(move |error| {
        let _ = app_for_error.emit("recording-error", error.user_message());
    });

    // Raw mixed-audio tap: the pipeline forwards every mixed window (600ms)
    // here in addition to (unused) VAD segmentation.
    let (raw_sender, mut raw_receiver) = live_pcm_channel();

    let transcription_receiver = manager
        .start_recording(microphone_device, system_device, false, Some(3_000), Some(raw_sender))
        .await
        .map_err(|error| super::recording_commands::map_recording_start_error(&app, error))?;

    // Forward mixed PCM windows to the webview. The bounded producer awaits
    // this consumer, preserving every window while limiting queued PCM memory.
    let app_for_pcm = app.clone();
    let forward_task = tokio::spawn(async move {
        let app = app_for_pcm;
        while let Some(chunk) = raw_receiver.recv().await {
            if chunk.data.is_empty() {
                continue;
            }
            let level = (chunk.data.iter().map(|x| {
                let s = x.clamp(-1.0, 1.0);
                s * s
            }).sum::<f32>() / chunk.data.len().max(1) as f32).sqrt();
            let mut bytes = Vec::with_capacity(chunk.data.len() * 2);
            for sample in &chunk.data {
                let clamped = sample.clamp(-1.0, 1.0);
                let value = (clamped * 32767.0) as i16;
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            let event = PcmEvent {
                data: &local_runtime::encode_base64(&bytes),
                sample_rate: chunk.sample_rate,
                level,
            };
            if let Err(e) = app.emit("live-pcm", event) {
                error!("Failed to emit PCM chunk: {e}");
                break;
            }
        }
        info!("PCM stream task ended");
    });

    let transcription_drain_task = tokio::spawn(async move {
        let mut discarded = transcription_receiver;
        while discarded.recv().await.is_some() {}
    });

    let device_event_receiver = manager.take_device_event_receiver();
    let session_state = manager.get_state().clone();
    {
        let mut guard = LIVE_PCM.lock().unwrap();
        *guard = Some(LivePcmSession {
            manager,
            forward_task,
            transcription_drain_task,
            started_at: Instant::now(),
        });
    }

    if let Some(receiver) = device_event_receiver {
        super::recording_commands::spawn_device_event_processor(app.clone(), receiver, session_state);
    }

    super::recording_commands::finalize_recording_start(true);
    crate::tray::update_tray_menu(&app);
    drop(engine_lifecycle_guard);

    if let Err(error) = app.emit("recording-started", serde_json::json!({
        "message": "Live interpretation started",
        "live_interpretation": true,
        "pcm_stream": true,
    })) {
        stop_live_pcm_stream(app.clone()).await?;
        return Err(error.to_string());
    }

    info!("✅ Live PCM stream started (source: {:?})", args.source);
    Ok(())
}

/// Stop the PCM stream and clean up. Safe to call when not active.
pub async fn stop_live_pcm_stream<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let session = {
        let mut guard = LIVE_PCM.lock().unwrap();
        guard.take()
    };
    let Some(mut session) = session else {
        return Ok(());
    };

    info!("🛑 Stopping live PCM stream");
    let _ = app.emit("recording-shutdown-progress", serde_json::json!({
        "stage": "stopping_audio",
        "message": "음성 입력을 중지하고 있습니다.",
        "progress": 20
    }));

    if let Err(e) = session.manager.stop_streams_and_force_flush().await {
        warn!("Stream stop error during PCM shutdown: {e}");
    }
    session.manager.cleanup_without_save().await;
    if let Err(e) = session.forward_task.await {
        warn!("PCM stream task failed during shutdown: {e}");
    }
    if let Err(e) = session.transcription_drain_task.await {
        warn!("Transcription drain task failed during shutdown: {e}");
    }

    super::recording_commands::recording_stopped_cleanup(&app, true);
    crate::tray::update_tray_menu(&app);

    let duration = session.started_at.elapsed().as_secs();
    info!("✅ Live PCM stream stopped after {duration}s");
    Ok(())
}

#[tauri::command]
pub async fn is_live_pcm_stream_active() -> Result<bool, String> {
    Ok(is_active())
}

#[tauri::command]
pub async fn start_live_pcm_stream_command<R: Runtime>(
    app: AppHandle<R>,
    args: LivePcmArgs,
) -> Result<(), String> {
    start_live_pcm_stream(app, args).await
}

#[tauri::command]
pub async fn stop_live_pcm_stream_command<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    stop_live_pcm_stream(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::FutureExt;

    fn test_chunk(chunk_id: u64) -> AudioChunk {
        AudioChunk {
            data: vec![chunk_id as f32],
            sample_rate: 48_000,
            timestamp: chunk_id as f64,
            chunk_id,
            device_type: super::super::recording_state::DeviceType::Microphone,
        }
    }

    #[tokio::test]
    async fn live_pcm_channel_applies_backpressure_without_dropping_chunks() {
        // Given: a live PCM channel filled to its configured capacity.
        let (sender, mut receiver) = live_pcm_channel();
        for chunk_id in 0..LIVE_PCM_CHANNEL_CAPACITY as u64 {
            sender.send(test_chunk(chunk_id)).await.unwrap();
        }

        // When: one more chunk is sent before the receiver frees capacity.
        let overflow_chunk_id = LIVE_PCM_CHANNEL_CAPACITY as u64;
        let first = {
            let overflow_sender = sender.clone();
            let blocked_send = overflow_sender.send(test_chunk(overflow_chunk_id));
            tokio::pin!(blocked_send);
            assert!(blocked_send.as_mut().now_or_never().is_none());
            let first = receiver.recv().await.unwrap();
            blocked_send.await.unwrap();
            first
        };
        drop(sender);

        // Then: backpressure releases after a receive and every chunk remains ordered.
        let mut chunk_ids = vec![first.chunk_id];
        while let Some(chunk) = receiver.recv().await {
            chunk_ids.push(chunk.chunk_id);
        }
        assert_eq!(
            chunk_ids,
            (0..=overflow_chunk_id).collect::<Vec<_>>(),
        );
    }
}
