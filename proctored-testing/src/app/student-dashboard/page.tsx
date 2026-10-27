'use client';

import { useEffect, useState } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import StudentGuard from '@/components/StudentGuard';
import { parseDate, formatDateTime } from '@/lib/dateUtils';
import { Trophy } from 'lucide-react';
import ShootingStars from '@/components/ShootingStars';
import BackButton from '@/components/BackButton';

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
        const res = await fetch('/api/tests-list');
        const testsList = await res.json();
        const allResults: Result[] = [];
        
        if (Array.isArray(testsList)) {
          for (const test of testsList) {
            const testId = test.id;
            const resultSnap = await get(ref(rtdb, `results/${testId}/${u.uid}`));
            const resultVal = resultSnap.val();
            
            if (resultVal) {
              allResults.push({
                ...resultVal,
                testId: testId,
                testTitle: test.title,
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
    <main className="dashboard-main" style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <ShootingStars />
      
      <div className="container-narrow dashboard-container" style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <BackButton fallbackUrl="/select-test" />
        </div>
        {/* Header */}
        <div className="dashboard-header" style={{ textAlign: 'center', animation: 'fadeInDown 0.6s ease-out' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: '8px', background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.05) 100%)', border: '1px solid rgba(251, 191, 36, 0.3)', marginBottom: 'var(--space-lg)' }}>
            <Trophy size={40} color="#fbbf24" style={{ filter: 'drop-shadow(0 2px 4px rgba(251, 191, 36, 0.3))' }} />
          </div>
          <h1 className="dashboard-h1" style={{ fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 'var(--space-xs)', background: 'linear-gradient(to right, #fff, #a1a1aa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Candidate Portal
          </h1>
          <p style={{ fontSize: '1.125rem', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{user?.displayName || user?.email}</strong>
          </p>
        </div>

        {results.length === 0 ? (
          <div className="card dashboard-card" style={{ textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ width: 64, height: 64, margin: '0 auto var(--space-md)', borderRadius: '8px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xs)' }}>No Results Declared</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              Your examination results have not been published yet. Please check back later.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
            {results.map((result, idx) => (
              <div 
                className="dashboard-card"
                key={result.testId} 
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px', 
                  animation: `fadeInUp 0.6s ease-out ${idx * 0.15}s both`,
                  transition: 'transform 0.3s ease, border-color 0.3s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div className="flex justify-between items-start dashboard-card-header" style={{ gap: 'var(--space-md)' }}>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 8 }}>Assessment</div>
                    <h3 className="dashboard-h3" style={{ fontWeight: 700, letterSpacing: '-0.02em', color: '#fff', wordBreak: 'break-word' }}>{result.testTitle}</h3>
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      background: result.roundStatus === 'Qualified' ? 'rgba(16, 185, 129, 0.1)' : result.roundStatus === 'Eliminated' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                      color: result.roundStatus === 'Qualified' ? '#34d399' : result.roundStatus === 'Eliminated' ? '#f87171' : '#a1a1aa',
                      border: `1px solid ${result.roundStatus === 'Qualified' ? 'rgba(16, 185, 129, 0.2)' : result.roundStatus === 'Eliminated' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                    }}
                  >
                    {result.roundStatus || 'Results awaited'}
                  </span>
                </div>
                
                {result.interviewScheduled && (
                  <div className="interview-box" style={{ 
                    background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.05) 0%, rgba(245, 158, 11, 0.02) 100%)', 
                    border: '1px solid rgba(251, 191, 36, 0.2)', 
                    borderRadius: '8px',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: '#fbbf24' }} />
                    <h4 style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: '10px', color: '#fbbf24', fontSize: '1.125rem', fontWeight: 600 }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      Interview Details
                    </h4>
                    <div className="grid-3 interview-grid">
                      <div>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 6 }}>Date & Time</div>
                        <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '1rem', textShadow: '0 0 2px rgba(255, 255, 255, 0.4)' }}>
                          {result.dateTime ? (parseDate(result.dateTime) ? formatDateTime(result.dateTime, 'ordinal') : result.dateTime) : 'TBA'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 6 }}>Panel No.</div>
                        <div style={{ fontWeight: 500, color: '#fff', fontSize: '1rem' }}>{result.panelNo || 'TBA'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 6 }}>Venue / Link</div>
                        <div style={{ fontWeight: 500, color: '#fff', fontSize: '1rem' }}>{result.venue || 'TBA'}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 'var(--space-2xl)' }}>
          <button
            className="btn btn-ghost"
            id="signout-dashboard"
            onClick={() => auth.signOut()}
            style={{ 
              padding: '12px 24px', 
              color: 'var(--text-muted)', 
              fontSize: '0.9375rem', 
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            ← Sign Out securely
          </button>
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .dashboard-main { padding: var(--space-xl); }
        .dashboard-container { padding-top: var(--space-2xl); }
        .dashboard-header { margin-bottom: var(--space-2xl); }
        .dashboard-h1 { font-size: 3rem; }
        .dashboard-h3 { font-size: 1.75rem; }
        .dashboard-card { padding: var(--space-xl); }
        .dashboard-card-header { margin-bottom: var(--space-xl); }
        .interview-box { margin-top: var(--space-lg); padding: var(--space-lg); }
        .interview-grid { gap: var(--space-xl); }

        @media (max-width: 768px) {
          .dashboard-main { padding: var(--space-md) var(--space-sm); }
          .dashboard-container { padding-top: var(--space-xl); }
          .dashboard-header { margin-bottom: var(--space-xl); }
          .dashboard-h1 { font-size: 2rem !important; }
          .dashboard-h3 { font-size: 1.3rem !important; }
          .dashboard-card { padding: var(--space-md); }
          .dashboard-card-header { margin-bottom: var(--space-lg); }
          .interview-box { margin-top: var(--space-md); padding: var(--space-md); }
          .interview-grid { gap: var(--space-md) !important; }
        }
      `}} />
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
