'use client';

import AdminGuard from '@/components/AdminGuard';
import BackButton from '@/components/BackButton';
import LiveStatsView from '@/components/LiveStatsView';

function LiveStatsPageContent() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ marginBottom: 16 }}>
        <BackButton fallbackUrl="/admin" />
      </div>
      <LiveStatsView userRole="Admin Sr." />
    </div>
  );
}

export default function LiveStatsPage() {
  return (
    <AdminGuard>
      <LiveStatsPageContent />
    </AdminGuard>
  );
}
