'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import { Clock, CheckCircle, XCircle, Check } from 'lucide-react';
import Image from 'next/image';

function WaitingRoomContent() {
  const router = useRouter();
  const [user, setUser] = useState<{ displayName: string | null; email: string | null } | null>(null);
  const [testStatus, setTestStatus] = useState<string>('pending');
  const [scheduledStart, setScheduledStart] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUser({ displayName: u.displayName, email: u.email });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const stateRef = ref(rtdb, 'testState');
    const unsub = onValue(stateRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      setTestStatus(data.status || 'pending');
      setScheduledStart(data.scheduledStart || null);
      if (data.status === 'active') {
        router.replace('/test');
      }
    });
    return () => unsub();
  }, [router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-xl)',
      }}
    >
      <div className="card" style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        {/* Brand mark */}
        <div style={{ marginBottom: 'var(--space-md)', width: 72, height: 72, margin: '0 auto var(--space-md)', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--border-light)' }}>
          <Image src="/aerosoc_logo.jpeg" alt="AeroSoc Logo" width={72} height={72} style={{ objectFit: 'cover' }} />
        </div>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-sm)' }}>Waiting Room</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
          Welcome, <strong style={{ color: 'var(--text-primary)' }}>{user?.displayName || user?.email}</strong>.
          The examination will begin shortly.
        </p>

        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-xl)',
            marginBottom: 'var(--space-xl)',
          }}
        >
          <div
            style={{
              fontSize: '0.6875rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            Test Status
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: testStatus === 'active' ? '#52b788' : 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {testStatus === 'pending' && <><Clock size={20} /> Waiting for Admin</>}
            {testStatus === 'active' && <><CheckCircle size={20} /> Test Active - Redirecting...</>}
            {testStatus === 'ended' && <><XCircle size={20} /> Test Ended</>}
          </div>

          {scheduledStart && testStatus === 'pending' && (
            <div style={{ marginTop: 'var(--space-md)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Scheduled start:{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>
                {new Date(scheduledStart).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </strong>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div style={{ textAlign: 'left' }}>
          <h3 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Before You Begin
          </h3>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Ensure you are in a well-lit, quiet room',
              'Your webcam and microphone will be required',
              'The test must run in fullscreen mode',
              'Do not switch tabs or minimize the window',
              'Keep your face clearly visible in the webcam',
              'Multiple faces in the frame will be flagged',
            ].map((rule, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                <div style={{ marginTop: 2 }}><Check size={16} color="var(--accent-green-light)" /></div>
                {rule}
              </li>
            ))}
          </ul>
        </div>

        <div className="divider" />

        <button
          className="btn btn-ghost btn-sm"
          id="signout-waiting"
          onClick={() => auth.signOut()}
          style={{ color: 'var(--text-dim)' }}
        >
          Sign Out
        </button>
      </div>
    </main>
  );
}

export default function WaitingRoomPage() {
  return (
    <StudentGuard>
      <WaitingRoomContent />
    </StudentGuard>
  );
}
