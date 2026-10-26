'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import TCCCom from '@/components/TCCCom';
import Image from 'next/image';
import Link from 'next/link';
import { Shield } from 'lucide-react';

function TCCPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSessionId = searchParams.get('session');

  return (
    <main className="page-wrapper" style={{ minHeight: '100vh', padding: '12px 16px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Compact Navigation Bar */}
        <nav
          className="navbar"
          style={{
            marginBottom: 12,
            borderRadius: 'var(--radius-md)',
            padding: '8px 16px',
            border: '1px solid var(--border)',
          }}
        >
          <div className="brand">
            <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-xs)', overflow: 'hidden' }}>
              <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={28} height={28} style={{ objectFit: 'cover' }} />
            </div>
            <div>
              <div className="brand-name" style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
                AeroSoc Testing Platform
              </div>
              <div className="brand-sub" style={{ fontSize: '0.625rem', letterSpacing: '0.08em' }}>
                BIT Mesra &middot; Team Coordination Corner
              </div>
            </div>
          </div>

          <div className="flex items-center gap-sm">
            <Link href="/admin" className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
              Admin Sr.
            </Link>
            <Link href="/admin-l1" className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
              Admin L1
            </Link>
            <Link href="/question-setter" className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
              Question Setter
            </Link>
            <Link href="/admin/logs" className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
              Audit Logs
            </Link>
          </div>
        </nav>

        {/* TCC Component */}
        <TCCCom
          initialSessionId={initialSessionId}
          onBackToDashboard={() => router.back()}
        />
      </div>
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
