'use client';

import './globals.css';
import 'sonner/dist/styles.css';
import dynamic from 'next/dynamic';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactNode } from 'react';
import { MacWindowControls } from '@/components/runtime/MacWindowControls';

const DesktopShell = dynamic(() => import('@/components/runtime/DesktopShell'), { ssr: false });
const WebWorkspace = dynamic(() => import('@/local/components/WebWorkspace'), { ssr: false });

export default function RootLayout({ children }: { children: ReactNode }) {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => { setNative(isTauri()); }, []);

  return (
    <html lang="ko">
      <head>
        <title>Meetily · 로컬 회의와 일본어 통역</title>
        <meta name="description" content="내 컴퓨터에서 회의 녹음, 전사, 요약과 일본어 한국어 동시통역을 사용하세요." />
      </head>
      <body className="font-sans antialiased">
        {native === null ? (
          <main className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600" role="status">Meetily를 준비하고 있습니다…</main>
        ) : native ? (
          <>
            <DesktopShell>{children}</DesktopShell>
            <MacWindowControls />
          </>
        ) : <WebWorkspace />}
      </body>
    </html>
  );
}
