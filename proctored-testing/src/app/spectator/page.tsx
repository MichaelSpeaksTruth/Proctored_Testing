'use client';

import { useState, useEffect, useMemo } from 'react';
import { rtdb, auth } from '@/lib/firebase';
import { ref, get } from 'firebase/database';
import RoleGuard from '@/components/RoleGuard';
import ExcelExport from '@/components/ExcelExport';
import LeaderboardTable, { LeaderboardEntry } from '@/components/LeaderboardTable';

interface TestOption { id: string; title: string; }

function SpectatorContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultsDeclared, setResultsDeclared] = useState(false);
  
  // Interviewer Mode states
  const [isInterviewerMode, setIsInterviewerMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch('/api/tests-list')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setTests(data);
          if (data.length > 0 && !selectedTestId) {
            setSelectedTestId(data[0].id);
          }
        }
      })
      .catch(console.error);
  }, [selectedTestId]);

  useEffect(() => {
    if (!selectedTestId) {
      setLeaderboard([]);
      setResultsDeclared(false);
      return;
    }
    const fetchExistingResults = async () => {
      setLoading(true);
      try {
        const testStateSnap = await get(ref(rtdb, `testState/${selectedTestId}`));
        const testState = testStateSnap.val();
        if (!testState || !testState.resultsDeclared) {
          setResultsDeclared(false);
          setLeaderboard([]);
          setLoading(false);
          return;
        }

        const resultsSnap = await get(ref(rtdb, `results/${selectedTestId}`));
        const resultsVal = resultsSnap.val();
        if (resultsVal) {
          setResultsDeclared(true);
          const uids = Object.keys(resultsVal);
          const entries: LeaderboardEntry[] = await Promise.all(uids.map(async (uid) => {
            const data = resultsVal[uid];
            
            // Get proctoring flags safely
            let flags: any[] = [];
            try {
              const flagsSnap = await get(ref(rtdb, `proctoringFlags/${uid}/${selectedTestId}/flags`));
              const flagsData = flagsSnap.val();
              if (flagsData) {
                flags = Object.values(flagsData);
              }
            } catch (err) {
              console.warn(`Could not read proctoring flags for ${uid}:`, err);
            }
            
            return {
              uid,
              name: data.name || 'Unknown Name',
              email: data.email || 'Unknown Email',
              score: data.score,
              total: data.total,
              rank: data.rank,
              roundStatus: data.roundStatus || 'Pending',
              flagCount: flags.length,
              flags,
              aiSeverity: data.aiSeverity,
              aiSummary: data.aiSummary,
              interviewScheduled: data.interviewScheduled,
              panelNo: data.panelNo,
              venue: data.venue,
              dateTime: data.dateTime,
              integrityFlag: data.integrityFlag,
              delaySeconds: data.delaySeconds,
              flagNote: data.flagNote,
            };
          }));
          entries.sort((a, b) => a.rank - b.rank);
          setLeaderboard(entries);
        } else {
          setResultsDeclared(false);
          setLeaderboard([]);
        }
      } catch (e) {
        console.error("Failed to load existing results", e);
        setResultsDeclared(false);
      } finally {
        setLoading(false);
      }
    };

    fetchExistingResults();
  }, [selectedTestId]);

  const filteredLeaderboard = useMemo(() => {
    let list = leaderboard;
    if (isInterviewerMode) {
      list = list.filter(e => e.roundStatus === 'Qualified' || e.roundStatus === 'Waitlisted');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
    }
    return list;
  }, [leaderboard, isInterviewerMode, searchQuery]);

  return (
    <main className="main-content" style={{ minHeight: '100vh', padding: '16px 0 var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: 1200 }}>
        {/* Header Bar */}
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Spectator Dashboard
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0 }}>
              Live leaderboard, evaluations, and proctoring inspection
            </p>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => auth.signOut()}
          >
            Sign Out
          </button>
        </div>
        
        {/* Test Selector */}
        <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: '14px 16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              Select Examination
            </label>
            <select value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
              <option value="">-- Select an examination --</option>
              {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
            </select>
          </div>
        </div>

        {selectedTestId && !loading && !resultsDeclared && (
          <div className="alert alert-info" style={{ marginBottom: 'var(--space-lg)' }}>
            Results have not been declared yet for this examination.
          </div>
        )}

        {loading && (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-md)' }} />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading evaluation records...</p>
          </div>
        )}

        {resultsDeclared && leaderboard.length > 0 && (
          <div className="card" style={{ padding: '16px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                marginBottom: 'var(--space-md)',
                paddingBottom: 12,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>Leaderboard</h2>
                <button 
                  className={`btn btn-sm ${isInterviewerMode ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => setIsInterviewerMode(!isInterviewerMode)}
                >
                  {isInterviewerMode ? 'Interviewer Mode: ON' : 'Interviewer Mode: OFF'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {isInterviewerMode && (
                  <input
                    type="text"
                    className="input"
                    placeholder="Search candidate name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ flex: '1 1 200px' }}
                  />
                )}
                <div style={{ flex: '0 0 auto' }}>
                  <ExcelExport data={filteredLeaderboard as any} filename={`leaderboard_${selectedTestId}.xlsx`} />
                </div>
              </div>
            </div>
            
            {isInterviewerMode && (
              <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)', fontSize: '0.8125rem' }}>
                <strong>Interviewer Mode Active:</strong> Showing Qualified and Waitlisted candidates. Tap &ldquo;Details&rdquo; to inspect proctoring logs.
              </div>
            )}

            <LeaderboardTable
              entries={filteredLeaderboard}
            />
          </div>
        )}
      </div>
    </main>
  );
}

export default function SpectatorPage() {
  return <RoleGuard requiredRole={["Spectator's View", "Admin L1"]}><SpectatorContent /></RoleGuard>;
}
