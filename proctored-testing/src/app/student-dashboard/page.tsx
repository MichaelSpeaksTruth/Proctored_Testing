'use client';

import { useEffect, useState } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import { Trophy } from 'lucide-react';

interface Result {
  score: number;
  total: number;
  rank: number;
  roundStatus: string;
  testId: string;
  testTitle: string;
  interviewScheduled?: boolean;
  panelNo?: string;
  venue?: string;
  dateTime?: string;
}

function StudentDashboardContent() {
  const [user, setUser] = useState<{ displayName: string | null; email: string | null; uid: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      setUser({ displayName: u.displayName, email: u.email, uid: u.uid });

      // Fetch all test results for this student
      try {
        const testsSnap = await get(ref(rtdb, 'tests'));
        const testsVal = testsSnap.val();
        const allResults: Result[] = [];
        
        if (testsVal) {
          for (const testId of Object.keys(testsVal)) {
            const resultSnap = await get(ref(rtdb, `results/${testId}/${u.uid}`));
            const resultVal = resultSnap.val();
            
            if (resultVal) {
              allResults.push({
                ...resultVal,
                testId: testId,
                testTitle: testsVal[testId].title || testId,
              });
            }
          }
        }
        setResults(allResults);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  if (loading) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container-narrow" style={{ paddingTop: 'var(--space-2xl)' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-2xl)' }}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <Trophy size={48} color="var(--accent-amber)" />
          </div>
          <h1>My Results</h1>
          <p style={{ marginTop: 'var(--space-sm)' }}>
            {user?.displayName || user?.email}
          </p>
        </div>

        {results.length === 0 ? (
          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Results have not been declared yet. Please check back later.
            </p>
          </div>
        ) : (
          results.map((result) => (
            <div className="card" key={result.testId} style={{ marginBottom: 'var(--space-lg)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
                <h3>{result.testTitle}</h3>
                <span
                  className={`badge ${
                    result.roundStatus === 'Qualified' ? 'badge-green' :
                    result.roundStatus === 'Eliminated' ? 'badge-red' : 'badge-gray'
                  }`}
                >
                  {result.roundStatus || 'Pending'}
                </span>
              </div>

              <div className="grid-3" style={{ gap: 'var(--space-md)', textAlign: 'center' }}>
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>Score</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--white)' }}>
                    {result.score}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/{result.total}</span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>Rank</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--white)' }}>
                    #{result.rank}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>Percentage</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--white)' }}>
                    {result.total > 0 ? ((result.score / result.total) * 100).toFixed(1) : '0'}%
                  </div>
                </div>
              </div>
              
              {result.interviewScheduled && (
                <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'var(--bg-card)', border: '1px solid var(--accent-amber)', borderRadius: 'var(--radius-md)' }}>
                  <h4 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-amber)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    Interview Details
                  </h4>
                  <div className="grid-3" style={{ gap: 'var(--space-md)' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Date & Time</div>
                      <div style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{result.dateTime || 'TBA'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Panel No.</div>
                      <div style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{result.panelNo || 'TBA'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Venue / Link</div>
                      <div style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{result.venue || 'TBA'}</div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          ))
        )}

        <div style={{ textAlign: 'center', marginTop: 'var(--space-xl)' }}>
          <button
            className="btn btn-outline btn-sm"
            id="signout-dashboard"
            onClick={() => auth.signOut()}
          >
            Sign Out
          </button>
        </div>
      </div>
    </main>
  );
}

export default function StudentDashboardPage() {
  return (
    <StudentGuard>
      <StudentDashboardContent />
    </StudentGuard>
  );
}
