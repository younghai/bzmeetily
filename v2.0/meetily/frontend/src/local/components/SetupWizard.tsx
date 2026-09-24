'use client';

import { CheckCircle2, CircleAlert, Cpu, LoaderCircle, Mic, ShieldCheck, Volume2 } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { Button } from '@/components/ui/button';

type RuntimeStatus = {
  readonly services: Record<string, { readonly state: string; readonly detail: string; readonly pid: number | null }>;
  readonly whisper_model: { readonly present: boolean; readonly path: string; readonly size_bytes: number | null };
  readonly ollama_model: { readonly present: boolean; readonly size_bytes: number | null };
  readonly disk_free_bytes: number | null;
  readonly requirements: { readonly whisper_bytes: number; readonly qwen_bytes: number };
  readonly ready: boolean;
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes <= 0) return '-';
  const gib = bytes / (1024 * 1024 * 1024);
  if (gib >= 1) return `${gib.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const REQUIRED_FREE_BYTES = 9 * 1024 * 1024 * 1024; // whisper(~1.6GB) + qwen(~3.4GB) + headroom

type PullProgress = {
  readonly status?: string;
  readonly completed?: number;
  readonly total?: number;
  readonly percent?: number;
  readonly error?: string;
};

type ModelProgress = {
  readonly modelName?: string;
  readonly progress?: number;
};

type Phase = 'checking' | 'whisper' | 'permissions';

export function SetupGate({ children }: { readonly children: ReactNode }) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [ready, setReady] = useState<boolean | null>(isTauri ? null : true);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const status = await invoke<RuntimeStatus>('local_runtime_status');
        if (!cancelled) setReady(status.ready);
      } catch {
        // Retry on the next tick; the runtime may still be starting.
      }
    };
    void check();
    const timer = globalThis.setInterval(check, 4_000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [isTauri]);

  if (ready !== true) return <SetupWizard initialReady={false} onReady={() => setReady(true)} />;
  return <>{children}</>;
}

export function SetupWizard({ initialReady, onReady }: { readonly initialReady: boolean; readonly onReady: () => void }) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [phase, setPhase] = useState<Phase>(initialReady ? 'permissions' : 'checking');
  const [whisperProgress, setWhisperProgress] = useState<number | null>(null);
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [qwenProgress, setQwenProgress] = useState<PullProgress | null>(null);
  const [qwenError, setQwenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const whisperListenerRef = useRef<UnlistenFn | null>(null);
  const pullListenerRef = useRef<UnlistenFn | null>(null);

  const refreshStatus = useCallback(async (): Promise<RuntimeStatus | null> => {
    try {
      const next = await invoke<RuntimeStatus>('local_runtime_status');
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = globalThis.setInterval(() => void refreshStatus(), 4_000);
    return () => globalThis.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    const wire = async (): Promise<void> => {
      whisperListenerRef.current = await listen<ModelProgress>('model-download-progress', (event) => {
        if (cancelled || event.payload.modelName !== 'large-v3-turbo') return;
        setWhisperProgress(event.payload.progress ?? 0);
      });
      pullListenerRef.current = await listen<PullProgress>('ollama-pull-progress', (event) => {
        if (cancelled) return;
        setQwenProgress(event.payload);
      });
    };
    void wire();
    return () => {
      cancelled = true;
      whisperListenerRef.current?.();
      pullListenerRef.current?.();
    };
  }, []);

  // First status decides the screen: models present → permission primer,
  // models missing → download cards (fresh install).
  useEffect(() => {
    if (!status) return;
    setPhase((current) => {
      if (current !== 'checking') return current;
      return status.ready ? 'permissions' : 'whisper';
    });
  }, [status?.ready]);

  const installWhisper = async (): Promise<void> => {
    setBusy(true);
    setWhisperError(null);
    setWhisperProgress(0);
    try {
      await invoke('local_install_whisper_model');
      setWhisperProgress(100);
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') {
        setWhisperProgress(null);
      } else {
        setWhisperError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const cancelWhisper = async (): Promise<void> => {
    try {
      await invoke('whisper_cancel_download', { modelName: 'large-v3-turbo' });
    } catch {
      // ignore
    }
    setWhisperProgress(null);
  };

  const installQwen = async (): Promise<void> => {
    setBusy(true);
    setQwenError(null);
    setQwenProgress({ status: 'starting', percent: 0 });
    try {
      await invoke('local_install_ollama_model');
      setQwenProgress({ status: 'success', percent: 100 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled') {
        setQwenProgress(null);
      } else {
        setQwenError(message);
      }
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  };

  const cancelQwen = async (): Promise<void> => {
    try {
      await invoke('local_cancel_ollama_pull');
    } catch {
      // ignore
    }
    setQwenProgress(null);
  };

  const startInterpretation = async (): Promise<void> => {
    setEnsureError(null);
    // A conflict (e.g. port 3118 held by another server) must stop here;
    // entering the app anyway would silently run against a foreign server.
    try {
      await invoke('local_runtime_ensure');
    } catch (error) {
      setEnsureError(error instanceof Error ? error.message : String(error));
      void refreshStatus();
      return;
    }
    void refreshStatus();
    onReady();
  };

  const openDataFolder = async (): Promise<void> => {
    await invoke('local_open_data_folder').catch(() => undefined);
  };

  const whisperDone = status?.whisper_model.present === true;
  const qwenDone = status?.ollama_model.present === true;
  const diskOk = (status?.disk_free_bytes ?? Number.MAX_SAFE_INTEGER) >= REQUIRED_FREE_BYTES;
  const missingBytes = ((status?.requirements.whisper_bytes ?? 0) + (status?.requirements.qwen_bytes ?? 0));

  if (phase === 'checking') {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <LoaderCircle className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm [word-break:keep-all]">로컬 통역 서비스 상태를 확인하고 있습니다…</p>
        </div>
      </main>
    );
  }

  if (phase === 'permissions') {
    return (
      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-blue-600">모델 준비 완료</p>
            <h1 className="text-2xl font-bold text-slate-900 [word-break:keep-all]">권한과 음성 입력을 확인하세요</h1>
            <p className="text-sm leading-relaxed text-slate-600 [word-break:keep-all]">
              일본어 음성을 전사하고 한국어로 통역하려면 macOS 권한 허용이 필요합니다. 아래 단계는 통역을 처음 시작할 때 다시 표시될 수 있습니다.
            </p>
          </div>
          <ol className="flex flex-col gap-3">
            <li className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <Mic className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">마이크 권한</p>
                <p className="mt-1 text-sm text-slate-600 [word-break:keep-all]">말하기를 마이크로 입력하려면 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 Meetily2를 허용하세요.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => invoke('trigger_microphone_permission').catch(() => undefined)}>
                  마이크 권한 열기
                </Button>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <Volume2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">컴퓨터 소리 권한</p>
                <p className="mt-1 text-sm text-slate-600 [word-break:keep-all]">회의 상대방의 소리를 컴퓨터 오디오로 입력하려면 필요합니다. 처음 통역 시작 시 macOS가 화면 기록·오디오 캡처 권한을 요청하면 허용하세요.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => invoke('trigger_system_audio_permission_command').catch(() => undefined)}>
                  화면 기록 권한 열기
                </Button>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">모든 음성 처리는 이 Mac 안에서</p>
                <p className="mt-1 text-sm text-slate-600 [word-break:keep-all]">전사·번역·요약은 인터넷 없이 로컬 모델로 처리되며, 음성이 외부로 전송되지 않습니다.</p>
              </div>
            </li>
          </ol>
          {ensureError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [word-break:keep-all]">
              {ensureError}
            </p>
          )}
          <div className="flex justify-end">
            <Button className="h-11 px-6" onClick={() => void startInterpretation()}>시작하기</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-blue-600">Meetily2 설정</p>
          <h1 className="text-2xl font-bold text-slate-900 [word-break:keep-all]">통역 모델을 준비합니다</h1>
          <p className="text-sm leading-relaxed text-slate-600 [word-break:keep-all]">
            일본어 전사(Whisper large-v3-turbo)와 한국어 통역(Qwen 3.5 4B) 모델을 이 Mac에 내려받습니다. 다운로드는 한 번만 필요하고, 이후에는 인터넷 없이 통역할 수 있습니다.
          </p>
        </div>

        <div className={`flex items-start gap-3 rounded-xl border p-4 ${diskOk ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
          <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-slate-900">저장 공간</p>
            <p className="mt-1 text-slate-600 [word-break:keep-all]">
              여유 공간 {formatBytes(status?.disk_free_bytes ?? null)} · 필요 약 {formatBytes(missingBytes || 5_000_000_000)}
              {status?.disk_free_bytes !== null && status?.disk_free_bytes !== undefined
                ? ` · 다운로드 중단 시 이어받기 지원`
                : ''}
            </p>
            {!diskOk && (
              <p className="mt-1 text-amber-700 [word-break:keep-all]">여유 공간이 부족합니다. 디스크를 정리한 뒤 다시 시도하세요.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {Object.entries(status?.services ?? {})
            .filter(([, service]) => service.state === 'conflict')
            .map(([name, service]) => (
              <p key={name} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [word-break:keep-all]">
                {name}: {service.detail}
              </p>
            ))}
          <ModelCard
            title="Whisper large-v3-turbo"
            description="일본어 음성을 실시간으로 전사합니다. 약 1.6 GB"
            done={whisperDone}
            progress={whisperProgress}
            error={whisperError}
            onStart={() => void installWhisper()}
            onCancel={() => void cancelWhisper()}
            disabled={busy && !whisperDone}
          />
          <ModelCard
            title="Qwen 3.5 4B"
            description="전사 문장을 자연스러운 한국어로 통역하고 회의를 요약합니다. 약 3.4 GB"
            done={qwenDone}
            progress={qwenProgress?.percent ?? null}
            progressLabel={qwenProgress?.status}
            error={qwenError}
            onStart={() => void installQwen()}
            onCancel={() => void cancelQwen()}
            disabled={busy && !qwenDone}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => void openDataFolder()}>데이터 폴더 열기</Button>
          <Button className="h-11 px-6" disabled={!(whisperDone && qwenDone)} onClick={() => void startInterpretation()}>
            {whisperDone && qwenDone ? '권한 설정으로 이동' : '두 모델을 모두 설치해 주세요'}
          </Button>
        </div>
      </div>
    </main>
  );
}

type ModelCardProps = {
  readonly title: string;
  readonly description: string;
  readonly done: boolean;
  readonly progress: number | null;
  readonly progressLabel?: string;
  readonly error?: string | null;
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly disabled?: boolean;
};

function ModelCard({ title, description, done, progress, progressLabel, error, onStart, onCancel, disabled }: ModelCardProps) {
  return (
    <div className={`rounded-xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {done
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : error
              ? <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              : <LoaderCircle className={`mt-0.5 h-5 w-5 shrink-0 text-slate-400 ${progress !== null ? 'animate-spin text-blue-600' : ''}`} />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 [word-break:keep-all]">{title}</p>
            <p className="mt-1 text-sm text-slate-600 [word-break:keep-all]">{description}</p>
          </div>
        </div>
        {done ? (
          <span className="shrink-0 text-sm font-medium text-emerald-700">설치됨</span>
        ) : progress !== null && progress !== undefined ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>중지</Button>
        ) : (
          <Button size="sm" onClick={onStart} disabled={disabled}>다운로드</Button>
        )}
      </div>
      {!done && progress !== null && progress !== undefined && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
          </div>
          <p className="text-xs text-slate-500">{progressLabel ?? '다운로드 중'} · {progress}%{progress < 100 ? ' (중단했다가 다시 시작하면 이어받습니다)' : ''}</p>
        </div>
      )}
      {!done && error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 [word-break:keep-all]">
          {error} <button className="ml-1 underline" onClick={onStart}>다시 시도</button>
        </p>
      )}
    </div>
  );
}
