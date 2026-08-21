'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';

interface EnrolledTest {
  id: string;
  title: string;
}

function SelectTestContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enrolledTests, setEnrolledTests] = useState<EnrolledTest[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u || !u.email) {
        setLoading(false);
        return;
      }
      
      try {
        const encodeEmail = (e: string) => e.replace(/\./g, ',');
        const key = encodeEmail(u.email.toLowerCase());
        
        const pSnap = await get(ref(rtdb, `participants/${key}`));
        if (!pSnap.exists() || pSnap.val()?.allowed !== true) {
          router.replace('/');
          return;
        }
        
        const val = pSnap.val();
        const testsObj = val.tests || {};
        const testIds = Object.keys(testsObj);
        
        if (testIds.length === 0) {
          setEnrolledTests([]);
          setLoading(false);
          return;
        }
        
        const testsSnap = await get(ref(rtdb, 'tests'));
        const testsVal = testsSnap.val();
        
        const arr: EnrolledTest[] = [];
        for (const tid of testIds) {
          // Ensure test has a title to filter out deleted "ghost" tests
          if (testsVal && testsVal[tid] && testsVal[tid].title) {
            arr.push({
              id: tid,
              title: testsVal[tid].title
            });
          }
        }
        
        // If they only have 1 valid test, just redirect them directly!
        if (arr.length === 1) {
          localStorage.setItem('pt_selected_test', arr[0].id);
          router.replace('/waiting-room');
          return;
        }

        setEnrolledTests(arr);
        
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const selectTest = (testId: string) => {
    localStorage.setItem('pt_selected_test', testId);
    router.push('/waiting-room');
  };

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ maxWidth: 600, width: '100%' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-sm)' }}>Select Examination</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-xl)' }}>
          You are enrolled in multiple examinations. Please select the one you wish to attend right now.
        </p>
        
        {enrolledTests.length === 0 ? (
          <div style={{ padding: 'var(--space-lg)', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ color: 'var(--text-muted)' }}>You are not currently enrolled in any tests. Please contact administration.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {enrolledTests.map(t => (
              <button 
                key={t.id} 
                onClick={() => selectTest(t.id)}
                className="btn btn-outline"
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'flex-start', 
                  padding: 'var(--space-md)', 
                  height: 'auto',
                  textAlign: 'left'
                }}
              >
                <strong style={{ fontSize: '1.125rem', color: 'var(--text-primary)', marginBottom: 4 }}>{t.title}</strong>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ID: {t.id}</span>
              </button>
            ))}
          </div>
        )}
        
        <div className="divider" style={{ marginTop: 'var(--space-xl)' }} />
        <div style={{ textAlign: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => auth.signOut()}
            style={{ color: 'var(--text-dim)' }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </main>
  );
}

export default function SelectTestPage() {
  return (
    <StudentGuard>
      <SelectTestContent />
    </StudentGuard>
  );
}
