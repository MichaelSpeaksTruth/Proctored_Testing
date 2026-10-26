'use client';

import { useState, useEffect } from 'react';
import { rtdb, auth } from '@/lib/firebase';
import { ref, set, get, update, onValue } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';
import BackButton from '@/components/BackButton';

interface TestOption { id: string; title: string; }

function ControlContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [testStatus, setTestStatus] = useState<string>('pending');
  const [scheduledStart, setScheduledStart] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tests-list')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setTests(data);
        }
      })
      .catch(console.error);

    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, snap => {
      const data = snap.val();
      if (data) {
        setTestStatus(data.status || 'pending');
        setSelectedTestId(data.activeTestId || '');
        setScheduledStart(data.scheduledStart || '');
      } else {
        setTestStatus('pending');
      }
    });
    return () => unsub();
  }, []);

  const revalidateCache = async () => {
    try {
      setLoading(true);
      setMsg('Purging global edge cache...');
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setMsg('Error: Could not retrieve admin token.');
        return;
      }
      const res = await fetch('/api/revalidate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg('Cache purged successfully. Hotfixes will now propagate.');
      } else {
        setMsg(`Cache purge failed: ${data.error}`);
      }
    } catch (e: any) {
      setMsg(`Cache purge error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startTest = async () => {
    if (!selectedTestId) { setMsg('Please select a test first.'); return; }
    setLoading(true);

    // Strip empty sections before going live
    const testSnap = await get(ref(rtdb, `tests/${selectedTestId}`));
    const testData = testSnap.val();
    if (testData && testData.sections) {
      const sectionsRaw = Array.isArray(testData.sections)
        ? testData.sections
        : Object.values(testData.sections as Record<string, unknown>);
      type SectionLike = { questions?: unknown };
      const withQuestions = (sectionsRaw as SectionLike[]).filter(
        (s) => s && Array.isArray(s.questions) ? s.questions.length > 0
          : typeof s.questions === 'object' && s.questions !== null
            ? Object.keys(s.questions).length > 0
            : false
      );
      if (withQuestions.length !== sectionsRaw.length) {
        await update(ref(rtdb, `tests/${selectedTestId}`), { sections: withQuestions });
        const removed = sectionsRaw.length - withQuestions.length;
        setMsg(`Removed ${removed} empty section${removed > 1 ? 's' : ''} before starting.`);
      }
    }

    await set(ref(rtdb, 'testState'), {
      status: 'active',
      activeTestId: selectedTestId,
      startedAt: new Date().toISOString(),
      scheduledStart: scheduledStart || null,
    });
    setMsg('Test started. Students are now being redirected.');
    setLoading(false);
  };

  const scheduleTest = async () => {
    if (!selectedTestId || !scheduledStart) return;
    setLoading(true);
    await set(ref(rtdb, 'testState'), {
      status: 'pending',
      activeTestId: selectedTestId,
      scheduledStart,
    });
    setMsg(`Test scheduled for ${new Date(scheduledStart).toLocaleString()}`);
    setLoading(false);
  };

  const forceEnd = async () => {
    if (!confirm('Are you sure you want to FORCE END the test? All student screens will be locked and answers auto-submitted.')) return;
    setLoading(true);
    await set(ref(rtdb, 'testState'), {
      status: 'ended',
      endedAt: new Date().toISOString(),
      activeTestId: selectedTestId,
    });
    await update(ref(rtdb, `tests/${selectedTestId}`), { status: 'ended' });
    setMsg('Test forcefully ended. All student screens are now locked.');
    setLoading(false);
  };

  const statusColor = testStatus === 'active' ? '#52b788' : testStatus === 'ended' ? 'var(--accent-red-light)' : 'var(--text-muted)';

  return (
    <main style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
          <BackButton fallbackUrl="/admin" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Control Panel</h1>
        </div>

        {msg && <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)' }}>{msg}</div>}

        {/* Live status */}
        <div className="card" style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: '14px 18px' }}>
          <div
            style={{
              width: 12, height: 12, borderRadius: '50%',
              background: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
              animation: testStatus === 'active' ? 'pulse-green 2s infinite' : 'none',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontWeight: 600, color: statusColor }}>
              {testStatus === 'pending' && 'Test Not Started'}
              {testStatus === 'active' && 'Test Live'}
              {testStatus === 'ended' && 'Test Ended'}
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {selectedTestId ? (tests.find(t => t.id === selectedTestId)?.title || selectedTestId) : 'No test selected'}
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ gap: 'var(--space-md)', alignItems: 'start' }}>
          {/* Start controls */}
          <div className="card" style={{ padding: '16px' }}>
            <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem' }}>Start Examination</h3>
            <div className="form-group">
              <label htmlFor="test-select">Select Test</label>
              <select id="test-select" value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
                <option value="">-- Select a test --</option>
                {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
              </select>
            </div>
            <button
              id="start-test-btn"
              className="btn btn-success"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 'var(--space-md)' }}
              onClick={startTest}
              disabled={loading || !selectedTestId || testStatus === 'active'}
            >
              Start Test Now
            </button>
            <div className="divider" />
            <div className="form-group">
              <label htmlFor="scheduled-start">Schedule Auto-Start</label>
              <input id="scheduled-start" type="datetime-local" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} />
            </div>
            <button
              id="schedule-test-btn"
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 'var(--space-md)' }}
              onClick={scheduleTest}
              disabled={loading || !selectedTestId || !scheduledStart}
            >
               Schedule Test
            </button>
            <div className="divider" />
            <h4 style={{ marginBottom: 'var(--space-sm)', color: 'var(--accent-red)' }}>Emergency Hotfix</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>Purge the Edge CDN cache for test questions globally.</p>
            <button
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
              onClick={revalidateCache}
              disabled={loading}
            >
              Purge Global Cache
            </button>
          </div>

          {/* Emergency controls */}
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)', color: 'var(--accent-red-light)' }}>Emergency Controls</h3>
            <p style={{ fontSize: '0.9375rem', marginBottom: 'var(--space-xl)' }}>
              Clicking Force End will immediately lock all student screens and auto-submit every answer.
              This action cannot be undone.
            </p>
            <button
              id="force-end-btn"
              className="btn btn-danger btn-lg"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={forceEnd}
              disabled={loading || testStatus !== 'active'}
            >
               Force End Test
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ControlPage() {
  return <AdminGuard><ControlContent /></AdminGuard>;
}
