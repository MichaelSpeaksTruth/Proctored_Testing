'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import TCCCom from '@/components/TCCCom';

function TCCPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSessionId = searchParams.get('session');

  return (
    <main
      style={{
        height: '100dvh',
        maxHeight: '100dvh',
        padding: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        background: 'var(--bg-primary)',
      }}
    >
      <TCCCom
        initialSessionId={initialSessionId}
        embedded={false}
        onBackToDashboard={() => router.back()}
      />
    </main>
  );
}

export default function TCCPage() {
  return (
    <Suspense
      fallback={
        <div className="loading-center" style={{ minHeight: '100vh' }}>
          <div className="spinner" />
        </div>
      }
    >
      <TCCPageInner />
    </Suspense>
  );
}
