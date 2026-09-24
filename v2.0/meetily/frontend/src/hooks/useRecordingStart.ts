import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/lib/recordingNotification';
import {
  getProviderCommands,
  hasDownloadingModel,
  type ModelWithStatus,
} from '@/lib/transcription-model-readiness';
import { toast } from 'sonner';

const TRANSCRIPTION_RUNTIME_START_ERROR_CODE = 'TRANSCRIPTION_RUNTIME_INITIALIZATION_FAILED';
const TRANSCRIPTION_RUNTIME_USER_MESSAGE = 'Speech recognition could not initialize. Restart Meetily. If the problem continues, repair or reinstall the app.';

const isTranscriptionRuntimeStartError = (error: unknown) =>
  String(error) === TRANSCRIPTION_RUNTIME_START_ERROR_CODE;

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
}

interface TranscriptConfig {
  provider?: string;
}

export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  // Synchronous latch: a rapid double-click re-enters handleRecordingStart
  // before any state update lands, so an async/state guard can't stop it.
  const isStartingRef = useRef(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  const getTranscriptionProvider = useCallback(async (): Promise<string> => {
    try {
      const config = await invoke<TranscriptConfig | null>('api_get_transcript_config');
      return config?.provider || 'parakeet';
    } catch (error) {
      console.error('Failed to load transcription provider:', error);
      return 'parakeet';
    }
  }, []);

  // Check the selected local transcription provider, not a hardcoded engine.
  const checkTranscriptionModelReady = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);

      if (commands) {
        await invoke(commands.initialize);
        return await invoke<boolean>(commands.hasAvailableModels);
      }

      console.error(`Unsupported transcription provider: ${provider}`);
      return false;
    } catch (error) {
      console.error('Failed to check transcription model status:', error);
      return false;
    }
  }, [getTranscriptionProvider]);

  // Check download status for the selected local transcription provider.
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);
      if (!commands) return false;

      const models = await invoke<ModelWithStatus[]>(commands.getAvailableModels);
      return hasDownloadingModel(models);
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false; // Default to not downloading (will show error + modal)
    }
  }, [getTranscriptionProvider]);

  // The Rust recording command validates the same provider again before capture.
  const checkModelReady = checkTranscriptionModelReady;

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    if (isStartingRef.current) {
      console.log('handleRecordingStart ignored - start already in progress');
      return;
    }
    isStartingRef.current = true;
    try {
      console.log('handleRecordingStart called - checking selected transcription model status');

      // Check the selected transcription model before starting.
      const modelReady = await checkModelReady();
      if (!modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page');
        } else {
          toast.error('Transcription model not ready', {
            description: 'Please download a transcription model before recording.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page');
        }
        setStatus(RecordingStatus.IDLE);
        return;
      }

      console.log('Selected transcription model ready - setting up meeting title and state');

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      // Start the actual backend recording
      console.log('Starting backend recording with meeting:', randomTitle);
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );
      console.log('Backend recording started successfully');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);
      Analytics.trackButtonClick('start_recording', 'home_page');

      // Show recording notification if enabled
      await showRecordingNotification();
    } catch (error) {
      console.error('Failed to start recording:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      // A racing second start that lost to a live recording must not clobber
      // the running recording's state. The winning start is live, so reflect
      // RECORDING here — leaving STARTING latched would keep the Stop button
      // disabled forever, since it's gated on isStartingRecording.
      if (errorMsg.includes('already in progress')) {
        console.warn('Start rejected because recording is already active - leaving live recording state untouched');
        setStatus(RecordingStatus.RECORDING);
        Analytics.trackButtonClick('start_recording_error', 'home_page');
        return;
      }

      const isRuntimeError = isTranscriptionRuntimeStartError(error);
      if (errorMsg.includes('Recording start timed out')) {
        toast.error('Recording start timed out — please try again');
      }

      setStatus(RecordingStatus.ERROR, isRuntimeError
        ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
        : errorMsg);
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      if (isRuntimeError) return;
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    } finally {
      isStartingRef.current = false;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkModelReady, checkIfModelDownloading, selectedDevices, showModal, setStatus]);

  useEffect(() => {
    if (sessionStorage.getItem('autoStartRecording') !== 'true') return;
    sessionStorage.removeItem('autoStartRecording');
    window.dispatchEvent(new CustomEvent('open-session-mode-chooser'));
  }, []);

  useEffect(() => {
    const handleDirectStart = () => {
      if (!isRecording) window.dispatchEvent(new CustomEvent('open-session-mode-chooser'));
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);
    return () => window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
  }, [isRecording]);

  return {
    handleRecordingStart,
  };
}
