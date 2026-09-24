// local_runtime.rs
//
// Meetily2 standalone runtime: owns the localhost services the app and browser
// UI depend on — the Ollama LLM server, the whisper.cpp transcription server,
// and the bundled meetily web/API server (bun-compiled sidecar).
//
// Design rules:
// - Start everything the app needs on launch; wait for health before "ready".
// - Reuse a foreign-but-compatible service already listening on a port instead
//   of fighting over it (e.g. a user's own Homebrew Ollama).
// - Never kill processes the app did not start; surface port conflicts instead.
// - Supervise owned children: restart when one dies unexpectedly.
// - Shut everything down when the app exits so relaunches start clean.

use std::io::Write as _;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use log::{error, info, warn};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const WHISPER_MODEL_NAME: &str = "large-v3-turbo";
pub const OLLAMA_MODEL_NAME: &str = "qwen3.5:4b";
pub const PORT_SERVER: u16 = 3118;
pub const PORT_WHISPER: u16 = 8178;
pub const PORT_OLLAMA: u16 = 11434;

/// Documented download sizes used for the free-space check in first-run setup.
pub const WHISPER_MODEL_DOWNLOAD_BYTES: u64 = 1_624_479_760; // ggml-large-v3-turbo.bin
pub const OLLAMA_MODEL_DOWNLOAD_BYTES: u64 = 3_400_000_000; // qwen3.5:4b (approx)

// ============================================================================
// STATE
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Ready,
    External,
    Starting,
    Stopped,
    Conflict,
    Failed,
}

impl ServiceState {
    fn as_str(self) -> &'static str {
        match self {
            ServiceState::Ready => "ready",
            ServiceState::External => "external",
            ServiceState::Starting => "starting",
            ServiceState::Stopped => "stopped",
            ServiceState::Conflict => "conflict",
            ServiceState::Failed => "failed",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ServiceKind {
    Ollama,
    Whisper,
    Server,
}

impl ServiceKind {
    fn label(self) -> &'static str {
        match self {
            ServiceKind::Ollama => "ollama",
            ServiceKind::Whisper => "whisper",
            ServiceKind::Server => "server",
        }
    }
}

struct OwnedService {
    kind: ServiceKind,
    child: tokio::process::Child,
    log: std::fs::File,
}

#[derive(Default)]
struct RuntimeInner {
    owned: Vec<OwnedService>,
    shutting_down: AtomicBool,
    pull_abort: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    /// Last state emitted per service so status queries can surface
    /// conflict/failed conditions that health probes alone cannot detect.
    last_states: Mutex<std::collections::HashMap<ServiceKind, (ServiceState, String)>>,
}

static RUNTIME: OnceLock<Mutex<RuntimeInner>> = OnceLock::new();
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn runtime() -> &'static Mutex<RuntimeInner> {
    RUNTIME.get_or_init(|| Mutex::new(RuntimeInner::default()))
}

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("failed to build runtime http client")
    })
}

fn shutdown_in_progress() -> bool {
    runtime()
        .lock()
        .unwrap()
        .shutting_down
        .load(Ordering::SeqCst)
}

fn owned_kinds() -> Vec<(ServiceKind, Option<u32>)> {
    let inner = runtime().lock().unwrap();
    inner
        .owned
        .iter()
        .map(|s| (s.kind, s.child.id()))
        .collect()
}

// ============================================================================
// PATHS
// ============================================================================

#[derive(Clone)]
pub struct RuntimePaths {
    pub executable_dir: PathBuf,
    pub resource_dir: PathBuf,
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub ollama_models_dir: PathBuf,
    pub whisper_model_path: PathBuf,
    pub log_dir: PathBuf,
    pub static_dir: PathBuf,
    pub whisper_public_dir: PathBuf,
}

pub fn resolve_paths<R: Runtime>(app: &AppHandle<R>) -> Result<RuntimePaths, String> {
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or("Failed to resolve executable directory")?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let models_dir = data_dir.join("models");
    let log_dir = data_dir.join("local-logs");

    let resources_root = resource_dir.join("resources");
    let static_dir = if resources_root.join("web-static").exists() {
        resources_root.join("web-static")
    } else {
        // Dev fallback: the Next.js export next to the source tree.
        resource_dir
            .parent()
            .map(|p| p.join("out"))
            .unwrap_or_else(|| resources_root.join("web-static"))
    };
    let whisper_public_dir = if resources_root.join("whisper-public").exists() {
        resources_root.join("whisper-public")
    } else {
        resource_dir
            .parent()
            .map(|p| p.join("public"))
            .unwrap_or_else(|| resources_root.join("whisper-public"))
    };

    let ollama_models_dir = models_dir.join("ollama");
    let whisper_model_path = models_dir.join(format!("ggml-{WHISPER_MODEL_NAME}.bin"));
    Ok(RuntimePaths {
        executable_dir,
        resource_dir,
        data_dir,
        models_dir,
        ollama_models_dir,
        whisper_model_path,
        log_dir,
        static_dir,
        whisper_public_dir,
    })
}

fn sidecar_path(paths: &RuntimePaths, name: &str) -> PathBuf {
    // Bundled externalBins are renamed by the bundler to drop the target
    // triple (Contents/MacOS/meetily-server). Keep the suffixed name as the
    // fallback for dev runs straight out of target/.
    let plain = paths.executable_dir.join(name);
    if plain.exists() {
        return plain;
    }
    let triple = format!("{}-apple-darwin", std::env::consts::ARCH);
    paths.executable_dir.join(format!("{name}-{triple}"))
}

// ============================================================================
// HEALTH / EVENTS
// ============================================================================

/// HTTP status of a GET probe when the server answers at all (even an error
/// status means the port is owned by an HTTP server, not a foreign process).
async fn probe_status_code(url: &str) -> Option<u16> {
    let response = client().get(url).send().await.ok()?;
    Some(response.status().as_u16())
}

async fn probe_json(url: &str) -> Option<serde_json::Value> {
    let response = client().get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<serde_json::Value>().await.ok()
}

fn emit_service_state<R: Runtime>(app: &AppHandle<R>, kind: ServiceKind, state: ServiceState, detail: &str) {
    {
        let inner = runtime().lock().unwrap();
        inner
            .last_states
            .lock()
            .unwrap()
            .insert(kind, (state, detail.to_string()));
    }
    let _ = app.emit(
        "local-runtime-status",
        json!({
            "service": kind.label(),
            "state": state.as_str(),
            "detail": detail,
        }),
    );
}

// ============================================================================
// START / SUPERVISE
// ============================================================================

fn open_log(paths: &RuntimePaths, name: &str) -> Result<std::fs::File, String> {
    std::fs::create_dir_all(&paths.log_dir).map_err(|e| e.to_string())?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(paths.log_dir.join(format!("{name}.log")))
        .map_err(|e| format!("Failed to open service log: {e}"))
}

async fn start_ollama<R: Runtime>(app: &AppHandle<R>, paths: &RuntimePaths) -> Result<(), String> {
    emit_service_state(app, ServiceKind::Ollama, ServiceState::Starting, "starting bundled ollama");
    let binary = sidecar_path(paths, "ollama");
    if !binary.exists() {
        return Err(format!("Bundled ollama not found at {}", binary.display()));
    }
    let _ = std::fs::create_dir_all(&paths.ollama_models_dir);
    let log = open_log(paths, "ollama")?;
    let registry_log = log.try_clone().map_err(|e| e.to_string())?;
    let child = tokio::process::Command::new(&binary)
        .arg("serve")
        .env("OLLAMA_HOST", format!("127.0.0.1:{PORT_OLLAMA}"))
        .env("OLLAMA_MODELS", &paths.ollama_models_dir)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn bundled ollama: {e}"))?;

    register_owned(app, ServiceKind::Ollama, child, registry_log, paths);
    Ok(())
}

async fn start_whisper<R: Runtime>(app: &AppHandle<R>, paths: &RuntimePaths) -> Result<(), String> {
    emit_service_state(app, ServiceKind::Whisper, ServiceState::Starting, "starting bundled whisper-server");
    let binary = sidecar_path(paths, "whisper-server");
    if !binary.exists() {
        return Err(format!("Bundled whisper-server not found at {}", binary.display()));
    }
    if !paths.whisper_model_path.exists() {
        return Err("Whisper model is not downloaded yet".to_string());
    }
    let log = open_log(paths, "whisper-server")?;
    let registry_log = log.try_clone().map_err(|e| e.to_string())?;
    let child = tokio::process::Command::new(&binary)
        .args(["--host", "127.0.0.1", "--port", &PORT_WHISPER.to_string(), "-m"])
        .arg(&paths.whisper_model_path)
        .args(["-l", "ja", "--public"])
        .arg(&paths.whisper_public_dir)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn bundled whisper-server: {e}"))?;

    register_owned(app, ServiceKind::Whisper, child, registry_log, paths);
    Ok(())
}

async fn start_server<R: Runtime>(app: &AppHandle<R>, paths: &RuntimePaths) -> Result<(), String> {
    emit_service_state(app, ServiceKind::Server, ServiceState::Starting, "starting local web server");
    let binary = sidecar_path(paths, "meetily-server");
    if !binary.exists() {
        return Err(format!("Bundled meetily-server not found at {}", binary.display()));
    }
    let ffmpeg = sidecar_path(paths, "ffmpeg");
    let log = open_log(paths, "meetily-server")?;
    let registry_log = log.try_clone().map_err(|e| e.to_string())?;
    let mut command = tokio::process::Command::new(&binary);
    command
        .env("MEETILY_LOCAL_PORT", PORT_SERVER.to_string())
        .env("MEETILY_DB_PATH", paths.data_dir.join("meeting_minutes.sqlite"))
        .env("MEETILY_INSTANCE_ID", paths.data_dir.to_string_lossy().to_string())
        .env("MEETILY_STATIC_DIR", &paths.static_dir)
        .env("MEETILY_WHISPER_URL", format!("http://127.0.0.1:{PORT_WHISPER}"))
        .env("MEETILY_OLLAMA_URL", format!("http://127.0.0.1:{PORT_OLLAMA}"))
        .env("MEETILY_OLLAMA_MODEL", OLLAMA_MODEL_NAME)
        .env("MEETILY_WHISPER_MODEL", WHISPER_MODEL_NAME)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true);
    if ffmpeg.exists() {
        command.env("MEETILY_FFMPEG_PATH", ffmpeg);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn bundled meetily-server: {e}"))?;

    register_owned(app, ServiceKind::Server, child, registry_log, paths);
    Ok(())
}

/// Keep the child handle alive and supervise it: when it dies unexpectedly
/// (app not shutting down), re-run the idempotent ensure loop after a delay.
fn register_owned<R: Runtime>(
    app: &AppHandle<R>,
    kind: ServiceKind,
    child: tokio::process::Child,
    log: std::fs::File,
    paths: &RuntimePaths,
) {
    {
        let mut inner = runtime().lock().unwrap();
        inner.owned.retain(|s| s.kind != kind);
        inner.owned.push(OwnedService {
            kind,
            child,
            log,
        });
    }

    let app = app.clone();
    let paths = paths.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if shutdown_in_progress() {
                return;
            }
            let dead = {
                let mut inner = runtime().lock().unwrap();
                match inner.owned.iter_mut().find(|s| s.kind == kind) {
                    Some(service) => matches!(service.child.try_wait(), Ok(Some(_))),
                    None => return, // replaced by a newer instance of the same service
                }
            };
            if dead {
                {
                    let mut inner = runtime().lock().unwrap();
                    inner.owned.retain(|s| s.kind != kind);
                }
                warn!("Bundled {} exited unexpectedly; will restart", kind.label());
                emit_service_state(&app, kind, ServiceState::Stopped, "process exited; restarting");
                // Retry with bounded exponential backoff: a single failed
                // restart (port still in TIME_WAIT, transient spawn error)
                // must not leave the service down for the whole session.
                let mut backoff = Duration::from_secs(3);
                for attempt in 1..=5u32 {
                    tokio::time::sleep(backoff).await;
                    if shutdown_in_progress() {
                        return;
                    }
                    match ensure_runtime(&app, Some(&paths)).await {
                        Ok(()) => return, // new spawn re-arms supervision
                        Err(e) => {
                            error!("Restart attempt {attempt}/5 for {} failed: {e}", kind.label());
                            backoff = (backoff * 2).min(Duration::from_secs(60));
                        }
                    }
                }
                emit_service_state(&app, kind, ServiceState::Failed, "repeated restart failures; restart Meetily2");
                return;
            }
        }
    });
}

/// Idempotently bring every service up. Reuses healthy/compatible services,
/// starts what is missing, and reports conflicts without killing anything.
pub async fn ensure_runtime<R: Runtime>(
    app: &AppHandle<R>,
    paths: Option<&RuntimePaths>,
) -> Result<(), String> {
    if shutdown_in_progress() {
        return Ok(());
    }
    let owned_paths;
    let paths = match paths {
        Some(p) => p,
        None => {
            owned_paths = resolve_paths(app)?;
            &owned_paths
        }
    };

    for dir in [&paths.data_dir, &paths.models_dir] {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }

    // 1. meetily-server (web UI + translation API). Required.
    let server_status = probe_json(&format!("http://127.0.0.1:{PORT_SERVER}/api/local/status")).await;
    if server_status.is_none() {
        if port_responds(PORT_SERVER).await {
            emit_service_state(app, ServiceKind::Server, ServiceState::Conflict, "port 3118 is used by another application");
            return Err("port 3118 is used by another application; close it and restart Meetily2".into());
        } else if let Err(e) = start_server(app, paths).await {
            emit_service_state(app, ServiceKind::Server, ServiceState::Failed, &e);
            error!("meetily-server failed to start: {e}");
        }
    } else {
        // Only reuse a server that serves THIS app's data directory. A server
        // for other data (older install, other fork) would silently store
        // meetings in the wrong place.
        let expected_instance = paths.data_dir.to_string_lossy().to_string();
        let served_instance = server_status
            .as_ref()
            .and_then(|value| value.get("instanceId"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if served_instance == expected_instance {
            emit_service_state(app, ServiceKind::Server, ServiceState::External, "reusing running local server");
        } else {
            emit_service_state(app, ServiceKind::Server, ServiceState::Conflict, "another Meetily local server is already running for different data");
            return Err("another Meetily local server (port 3118) is already running for a different data folder; stop it and restart Meetily2".into());
        }
    }

    // 2. Ollama. Required for translation/summary.
    let ollama_status = probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/version")).await;
    if ollama_status.is_none() {
        if port_responds(PORT_OLLAMA).await {
            emit_service_state(app, ServiceKind::Ollama, ServiceState::Conflict, "port 11434 is used by another application");
        } else if let Err(e) = start_ollama(app, paths).await {
            emit_service_state(app, ServiceKind::Ollama, ServiceState::Failed, &e);
            error!("ollama failed to start: {e}");
        }
    } else {
        emit_service_state(app, ServiceKind::Ollama, ServiceState::External, "reusing running ollama service");
    }

    // 3. whisper-server. Only meaningful once the model exists.
    if paths.whisper_model_path.exists() {
        let whisper_status = probe_json(&format!("http://127.0.0.1:{PORT_WHISPER}/health")).await;
        if whisper_status.is_none() {
            if let Some(status) = probe_status_code(&format!("http://127.0.0.1:{PORT_WHISPER}/health")).await {
                // whisper-server answers 503 while the model is still loading:
                // an HTTP response means a whisper-server owns the port, not a
                // foreign process — reuse it instead of flagging a conflict.
                if status == 503 {
                    emit_service_state(app, ServiceKind::Whisper, ServiceState::Starting, "whisper-server is still loading the model");
                } else {
                    emit_service_state(app, ServiceKind::Whisper, ServiceState::External, &format!("whisper server answered HTTP {status}"));
                }
            } else if port_responds(PORT_WHISPER).await {
                emit_service_state(app, ServiceKind::Whisper, ServiceState::Conflict, "port 8178 is used by another application");
            } else if let Err(e) = start_whisper(app, paths).await {
                emit_service_state(app, ServiceKind::Whisper, ServiceState::Failed, &e);
                error!("whisper-server failed to start: {e}");
            }
        } else {
            emit_service_state(app, ServiceKind::Whisper, ServiceState::External, "reusing running whisper server");
        }
    }

    Ok(())
}

async fn port_responds(port: u16) -> bool {
    tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .is_ok()
}

/// Wait until every required endpoint answers or the timeout elapses.
pub async fn wait_until_ready(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let server = probe_json(&format!("http://127.0.0.1:{PORT_SERVER}/api/local/status")).await;
        let ollama = probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/version")).await;
        if server.is_some() && ollama.is_some() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

// ============================================================================
// SHUTDOWN
// ============================================================================

pub fn shutdown() {
    {
        let inner = runtime().lock().unwrap();
        inner.shutting_down.store(true, Ordering::SeqCst);
    }
    // Cancel an in-flight pull first so its request task stops.
    let pull_sender = {
        let inner = runtime().lock().unwrap();
        let mut pending = inner.pull_abort.lock().unwrap();
        pending.take()
    };
    if let Some(sender) = pull_sender {
        let _ = sender.send(());
    }
    {
        let mut inner = runtime().lock().unwrap();
        for mut service in inner.owned.drain(..) {
            info!("Stopping bundled {} (pid {:?})", service.kind.label(), service.child.id());
            let _ = service.child.start_kill();
            let _ = service.log.flush();
        }
    }
    info!("Bundled local services stopped");
}

// ============================================================================
// STATUS REPORTING (Tauri commands)
// ============================================================================

#[derive(Serialize, Clone)]
pub struct ServiceReport {
    pub state: &'static str,
    pub detail: String,
    pub pid: Option<u32>,
}

#[derive(Serialize)]
pub struct RuntimeStatus {
    pub services: std::collections::BTreeMap<String, ServiceReport>,
    pub whisper_model: WhisperModelStatus,
    pub ollama_model: OllamaModelStatus,
    pub disk_free_bytes: Option<u64>,
    pub requirements: Requirements,
    pub ready: bool,
}

#[derive(Serialize)]
pub struct WhisperModelStatus {
    pub present: bool,
    pub path: String,
    pub size_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct OllamaModelStatus {
    pub present: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct Requirements {
    pub whisper_bytes: u64,
    pub qwen_bytes: u64,
}

async fn collect_status<R: Runtime>(app: &AppHandle<R>) -> Result<RuntimeStatus, String> {
    let paths = resolve_paths(app)?;

    let whisper_size = std::fs::metadata(&paths.whisper_model_path).ok().map(|m| m.len());
    let whisper_present = whisper_size.map(|s| s > 1_000_000).unwrap_or(false);

    let server_up = probe_json(&format!("http://127.0.0.1:{PORT_SERVER}/api/local/status"))
        .await
        .is_some();
    let ollama_up = probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/version"))
        .await
        .is_some();
    let whisper_up = probe_json(&format!("http://127.0.0.1:{PORT_WHISPER}/health"))
        .await
        .is_some();

    let ollama_model_size = if ollama_up {
        probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/tags"))
            .await
            .and_then(|tags| {
                tags.get("models")?
                    .as_array()?
                    .iter()
                    .find(|m| m.get("name").and_then(|n| n.as_str()) == Some(OLLAMA_MODEL_NAME))
                    .cloned()
            })
            .and_then(|m| m.get("size").and_then(|s| s.as_u64()))
    } else {
        None
    };

    let owned = owned_kinds();
    let owned_of = |kind: ServiceKind| -> Option<(ServiceState, Option<u32>)> {
        owned
            .iter()
            .find(|(k, _)| *k == kind)
            .map(|(_, pid)| (ServiceState::Ready, *pid))
    };

    let mut services = std::collections::BTreeMap::new();

    let server_report = match owned_of(ServiceKind::Server) {
        Some((state, pid)) => ServiceReport { state: state.as_str(), detail: "bundled local server".into(), pid },
        None if server_up => ServiceReport { state: ServiceState::External.as_str(), detail: "reusing running local server".into(), pid: None },
        None => ServiceReport { state: ServiceState::Stopped.as_str(), detail: "not running".into(), pid: None },
    };
    services.insert("server".to_string(), server_report);

    let ollama_report = match owned_of(ServiceKind::Ollama) {
        Some((state, pid)) => ServiceReport { state: state.as_str(), detail: "bundled ollama service".into(), pid },
        None if ollama_up => ServiceReport { state: ServiceState::External.as_str(), detail: "reusing running ollama service".into(), pid: None },
        None => ServiceReport { state: ServiceState::Stopped.as_str(), detail: "not running".into(), pid: None },
    };
    services.insert("ollama".to_string(), ollama_report);

    let whisper_report = match owned_of(ServiceKind::Whisper) {
        Some((state, pid)) => ServiceReport { state: state.as_str(), detail: "bundled whisper server".into(), pid },
        None if whisper_up => ServiceReport { state: ServiceState::External.as_str(), detail: "reusing running whisper server".into(), pid: None },
        None if !whisper_present => ServiceReport { state: ServiceState::Stopped.as_str(), detail: "waiting for whisper model download".into(), pid: None },
        None => ServiceReport { state: ServiceState::Stopped.as_str(), detail: "not running".into(), pid: None },
    };
    services.insert("whisper".to_string(), whisper_report);

    // Surface recorded conflict/failed conditions: health probes alone cannot
    // detect a port held by a foreign process, and the setup UI blocks on it.
    {
        let inner = runtime().lock().unwrap();
        let recorded = inner.last_states.lock().unwrap().clone();
        for (kind, (state, detail)) in recorded {
            if state == ServiceState::Conflict || state == ServiceState::Failed {
                if let Some(report) = services.get_mut(kind.label()) {
                    report.state = state.as_str();
                    report.detail = detail;
                }
            }
        }
    }

    let server_healthy = services.get("server").is_some_and(|s| {
        s.state != ServiceState::Stopped.as_str()
            && s.state != ServiceState::Conflict.as_str()
            && s.state != ServiceState::Failed.as_str()
    });
    let ready = whisper_present && ollama_model_size.is_some() && server_healthy;

    Ok(RuntimeStatus {
        services,
        whisper_model: WhisperModelStatus {
            present: whisper_present,
            path: paths.whisper_model_path.to_string_lossy().to_string(),
            size_bytes: whisper_size,
        },
        ollama_model: OllamaModelStatus {
            present: ollama_model_size.is_some(),
            size_bytes: ollama_model_size,
        },
        disk_free_bytes: disk_free_bytes(&paths.data_dir),
        requirements: Requirements {
            whisper_bytes: WHISPER_MODEL_DOWNLOAD_BYTES,
            qwen_bytes: OLLAMA_MODEL_DOWNLOAD_BYTES,
        },
        ready,
    })
}

fn disk_free_bytes(path: &std::path::Path) -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        let c_path = CString::new(path.to_str()?).ok()?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        // SAFETY: stat is a valid, fully-initialized struct; c_path outlives the call.
        let result = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
        if result == 0 {
            return Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64));
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }
}

#[tauri::command]
pub async fn local_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    collect_status(&app).await
}

#[tauri::command]
pub async fn local_runtime_ensure(app: AppHandle) -> Result<(), String> {
    ensure_runtime(&app, None).await
}

// ============================================================================
// MODEL INSTALLATION (first-run setup)
// ============================================================================

/// Download the whisper transcription model. Progress is emitted through the
/// existing `model-download-progress` / `model-download-complete` /
/// `model-download-error` events from whisper_engine. Resumable.
#[tauri::command]
pub async fn local_install_whisper_model(app: AppHandle) -> Result<(), String> {
    crate::whisper_engine::commands::whisper_download_model(app.clone(), WHISPER_MODEL_NAME.to_string())
        .await?;

    // Model ready: bring the transcription server up without waiting for the
    // next full ensure cycle.
    let paths = resolve_paths(&app)?;
    if paths.whisper_model_path.exists() {
        let health = probe_json(&format!("http://127.0.0.1:{PORT_WHISPER}/health")).await;
        if health.is_none() && !port_responds(PORT_WHISPER).await {
            if let Err(e) = start_whisper(&app, &paths).await {
                warn!("whisper-server could not start after download: {e}");
            }
        }
    }
    Ok(())
}

/// Stream `ollama pull` progress as `ollama-pull-progress` events:
/// { status, completed, total, percent }. Cancellable via local_cancel_ollama_pull.
#[tauri::command]
pub async fn local_install_ollama_model(app: AppHandle) -> Result<(), String> {
    // The ollama service must be up before a pull can start.
    if probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/version"))
        .await
        .is_none()
    {
        let paths = resolve_paths(&app)?;
        start_ollama(&app, &paths).await?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while probe_json(&format!("http://127.0.0.1:{PORT_OLLAMA}/api/version"))
            .await
            .is_none()
        {
            if Instant::now() >= deadline {
                return Err("ollama did not become ready in time".into());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let inner = runtime().lock().unwrap();
        *inner.pull_abort.lock().unwrap() = Some(abort_tx);
    }

    let url = format!("http://127.0.0.1:{PORT_OLLAMA}/api/pull");
    // No total timeout: a 3.4GB pull on a slow link legitimately exceeds an
    // hour. Stalls are caught by the per-read idle timeout in the loop below.
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .json(&json!({ "model": OLLAMA_MODEL_NAME, "stream": true }))
        .send()
        .await
        .map_err(|e| format!("Failed to start model pull: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Model pull failed with HTTP {}", response.status()));
    }

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut buffer: Vec<u8> = Vec::new();
    let mut last_percent: i64 = -1;

    let result = 'pull: loop {
        tokio::select! {
            _ = &mut abort_rx => break 'pull Err("cancelled".to_string()),
            chunk = tokio::time::timeout(Duration::from_secs(300), stream.next()) => {
                let chunk_result = match chunk {
                    Ok(result) => result,
                    Err(_) => break 'pull Err(
                        "Model pull stalled: no data received for 5 minutes. Check the network and retry.".to_string(),
                    ),
                };
                let Some(chunk_result) = chunk_result else { break Ok(()); };
                let chunk = match chunk_result {
                    Ok(c) => c,
                    Err(e) => break 'pull Err(format!("Model pull stream failed: {e}")),
                };
                buffer.extend_from_slice(&chunk);
                while let Some(position) = buffer.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=position).collect();
                    let line = String::from_utf8_lossy(&line);
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                        continue;
                    };
                    if let Some(error_text) = value.get("error").and_then(|e| e.as_str()) {
                        let _ = app.emit("ollama-pull-progress", json!({
                            "status": "error", "error": error_text,
                        }));
                        break 'pull Err(format!("Model pull failed: {error_text}"));
                    }
                    let status_text = value.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    let total = value.get("total").and_then(|t| t.as_u64()).unwrap_or(0);
                    let completed = value.get("completed").and_then(|c| c.as_u64()).unwrap_or(0);
                    let percent = if total > 0 {
                        (completed as f64 / total as f64 * 100.0) as i64
                    } else {
                        -1
                    };
                    if percent != last_percent || status_text != "downloading digest" {
                        last_percent = percent;
                        let _ = app.emit("ollama-pull-progress", json!({
                            "status": status_text,
                            "completed": completed,
                            "total": total,
                            "percent": percent,
                        }));
                    }
                }
            }
        }
    };

    {
        let inner = runtime().lock().unwrap();
        *inner.pull_abort.lock().unwrap() = None;
    }

    match &result {
        Ok(()) => {
            let _ = app.emit("ollama-pull-progress", json!({ "status": "success", "percent": 100 }));
            info!("Ollama model pull finished: {OLLAMA_MODEL_NAME}");
        }
        Err(e) if e == "cancelled" => info!("Ollama pull cancelled by user"),
        Err(e) => error!("Ollama pull failed: {e}"),
    }
    result
}

#[tauri::command]
pub async fn local_cancel_ollama_pull() -> Result<(), String> {
    if let Some(sender) = runtime()
        .lock()
        .unwrap()
        .pull_abort
        .lock()
        .unwrap()
        .take()
    {
        let _ = sender.send(());
    }
    Ok(())
}

/// Open the app data folder (used by setup/repair guidance).
#[tauri::command]
pub async fn local_open_data_folder(app: AppHandle) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    std::fs::create_dir_all(&paths.data_dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&paths.data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &paths;
    Ok(())
}

/// Shared base64 encoder for binary payloads sent over Tauri events.
pub(crate) fn encode_base64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}
