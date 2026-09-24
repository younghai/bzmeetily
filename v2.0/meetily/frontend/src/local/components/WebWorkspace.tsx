'use client';

import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { useWorkspace } from '../useWorkspace';
import { MeetingHeader } from './MeetingHeader';
import { MeetingSetup } from './MeetingSetup';
import { MeetingSidebar } from './MeetingSidebar';
import { RecordingControls } from './RecordingControls';
import { SummaryPanel } from './SummaryPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { useRecordingController } from './useRecordingController';
import { LiveInterpretation } from './LiveInterpretation';
import { SessionModeChooser, type SessionMode } from './SessionModeChooser';

export function WebWorkspace() {
  const [mode, setMode] = useState<SessionMode | null>(null);
  const workspace = useWorkspace();
  const recording = useRecordingController({
    meeting: workspace.selected,
    serviceStatus: workspace.status,
    disabled: workspace.loading || workspace.busy,
    onSegments: workspace.appendSegments,
    onReload: workspace.loadMeeting,
  });
  const interactionLocked = workspace.loading || workspace.busy || recording.locked;
  const operationLabel = workspace.operation === 'importing'
    ? '파일을 전사·번역하는 중…'
    : workspace.operation === 'summarizing'
      ? '한국어 요약을 생성하는 중…'
      : workspace.operation === 'creating'
        ? '새 회의를 만드는 중…'
        : workspace.operation === 'renaming'
          ? '회의 제목을 저장하는 중…'
          : null;

  if (mode === null) {
    return <main className="h-screen overflow-y-auto bg-slate-50"><SessionModeChooser onSelect={setMode} /></main>;
  }

  if (mode === 'interpretation') {
    return <LiveInterpretation status={workspace.status} onClose={() => setMode(null)} onRefreshStatus={() => void workspace.refreshStatus()} />;
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50 font-sans text-slate-900 [word-break:keep-all] md:flex-row">
      <MeetingSidebar
        meetings={workspace.meetings}
        selectedId={workspace.selected?.id ?? null}
        disabled={interactionLocked}
        onSelect={(id) => void workspace.loadMeeting(id)}
      />
      <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button type="button" disabled={interactionLocked} onClick={() => setMode(null)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">모드 선택</button>
              <p className="text-xs font-medium text-slate-600">
              로컬 서비스 · {workspace.status?.ready ? '준비됨' : '준비 확인 필요'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-500">브라우저에서 같은 기기의 로컬 서비스에 연결됩니다.</p>
              <button type="button" disabled={interactionLocked} onClick={() => void workspace.refreshStatus()} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
                상태 새로고침
              </button>
            </div>
          </div>

          <MeetingSetup disabled={interactionLocked || workspace.busy} onCreate={workspace.create} onImport={workspace.importFile} />

          {operationLabel && (
            <div role="status" className="flex items-center rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-800">
              <LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> {operationLabel}
            </div>
          )}

          {workspace.error && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <span className="flex items-start gap-2"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{workspace.error}</span>
              <button type="button" onClick={() => void workspace.initialize()} className="flex h-9 items-center gap-1 rounded-lg border border-red-300 px-3 font-medium outline-none focus:ring-2 focus:ring-red-500">
                <RotateCcw aria-hidden="true" className="h-4 w-4" /> 다시 연결
              </button>
            </div>
          )}

          {workspace.loading ? (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-600" role="status">
              <LoaderCircle aria-hidden="true" className="mr-2 h-5 w-5 animate-spin" /> 회의를 불러오는 중
            </div>
          ) : workspace.selected ? (
            <>
              <MeetingHeader
                meeting={workspace.selected}
                disabled={interactionLocked}
                onRename={workspace.rename}
                onReload={() => void workspace.loadMeeting(workspace.selected?.id ?? '')}
              />
              <RecordingControls
                meeting={workspace.selected}
                status={workspace.status}
                phase={recording.phase}
                source={recording.source}
                level={recording.level}
                elapsed={recording.elapsed}
                pending={recording.pending}
                error={recording.error}
                disabled={workspace.loading || workspace.busy}
                startBlock={recording.startBlock}
                recoverable={recording.recoverable}
                onSource={recording.setSource}
                onStart={() => void recording.start()}
                onStop={() => void recording.stop()}
                onRetry={() => recording.recoverable ? void recording.retry() : recording.clearError()}
              />
              <TranscriptPanel
                key={`transcript-${workspace.selected.id}`}
                segments={workspace.selected.segments}
                language={workspace.selected.language}
                interpret={workspace.selected.interpret}
                source={recording.source}
                recordingLocked={recording.locked}
              />
              <SummaryPanel key={`summary-${workspace.selected.id}`} meeting={workspace.selected} disabled={interactionLocked} onGenerate={() => void workspace.summarize()} />
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white px-5 py-16 text-center">
              <h2 className="text-lg font-semibold text-slate-900">새 회의를 만들어 시작하세요.</h2>
              <p className="mt-2 text-sm text-slate-500">기존 회의는 그대로 유지되며, 위에서 녹음 또는 오디오 가져오기를 선택할 수 있습니다.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default WebWorkspace;
