'use client';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize2, Minus, X } from 'lucide-react';
import { toast } from 'sonner';

async function runWindowAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error('[MacWindowControls] Window action failed:', error);
    toast.error('창을 제어할 수 없습니다.');
  }
}

export function MacWindowControls() {
  return (
    <div
      role="toolbar"
      aria-label="macOS 창 제어"
      className="fixed left-2 top-3 z-[60] flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm"
    >
      <button
        type="button"
        aria-label="창 닫기"
        title="창 닫기"
        onClick={() => void runWindowAction(() => getCurrentWindow().close())}
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="창 최소화"
        title="창 최소화"
        onClick={() => void runWindowAction(() => getCurrentWindow().minimize())}
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="전체 화면 전환"
        title="전체 화면 전환"
        onClick={() => void runWindowAction(async () => {
          const window = getCurrentWindow();
          await window.setFullscreen(!(await window.isFullscreen()));
        })}
        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Maximize2 aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
