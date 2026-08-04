'use client';

import { useState, useEffect } from 'react';
import { db, rtdb } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { ref, set, onValue, serverTimestamp } from 'firebase/database';
import AdminGuard from '@/components/AdminGuard';
import Link from 'next/link';

interface TestOption { id: string; title: string; }

function ControlContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [testStatus, setTestStatus] = useState<string>('pending');
  const [scheduledStart, setScheduledStart] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, 'tests')).then(snap =>
      setTests(snap.docs.map(d => ({ id: d.id, title: (d.data().title as string) || d.id })))
    );

    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, snap => {
      const data = snap.val();
      if (data) {
        setTestStatus(data.status || 'pending');
        if (data.activeTestId) setSelectedTestId(data.activeTestId);
      }
    });
    return () => unsub();
  }, []);

  const startTest = async () => {
    if (!selectedTestId) { setMsg('Please select a test first.'); return; }
    setLoading(true);
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
    });
    setMsg('Test forcefully ended. All student screens are now locked.');
    setLoading(false);
  };

  const statusColor = testStatus === 'active' ? '#52b788' : testStatus === 'ended' ? 'var(--accent-red-light)' : 'var(--text-muted)';

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container">
        <div className="flex items-center gap-md" style={{ marginBottom: 'var(--space-xl)' }}>
          <Link href="/admin" className="btn btn-ghost btn-sm">← Back</Link>
          <h1 style={{ fontSize: '1.75rem' }}>Control Panel</h1>
        </div>

        {msg && <div className="alert alert-info" style={{ marginBottom: 'var(--space-lg)' }}>{msg}</div>}

        {/* Live status */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
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
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {selectedTestId || 'No test selected'}
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ gap: 'var(--space-lg)', alignItems: 'start' }}>
          {/* Start controls */}
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Start Examination</h3>
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
              ▶ Start Test Now
            </button>
            <div className="divider" />
            <div className="form-group">
              <label htmlFor="scheduled-start">Schedule Auto-Start</label>
              <input id="scheduled-start" type="datetime-local" value={scheduledStart} onChange={e => setScheduledStart(e.target.value)} />
            </div>
            <button
              id="schedule-test-btn"
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={scheduleTest}
              disabled={loading || !selectedTestId || !scheduledStart}
            >
               Schedule Test
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
