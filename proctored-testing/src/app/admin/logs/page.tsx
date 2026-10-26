'use client';

import AdminGuard from '@/components/AdminGuard';
import EventsAuditView from '@/components/EventsAuditView';
import BackButton from '@/components/BackButton';

function AdminLogsContent() {
  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        {/* Navigation & Title */}
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <BackButton fallbackUrl="/admin" />
          <div>
            <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Global Audit Logs</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: 4 }}>
              Chronological platform activity records. Accessible exclusively to Admin Sr. with full review and deletion authority.
            </p>
          </div>
        </div>

        <EventsAuditView embeddedInAdmin={true} />
      </div>
    </main>
  );
}

export default function AdminLogsPage() {
  return (
    <AdminGuard>
      <AdminLogsContent />
    </AdminGuard>
  );
}
