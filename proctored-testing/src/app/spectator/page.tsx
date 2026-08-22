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
        }
      })
      .catch(console.error);
  }, []);

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
      } finally {
        setLoading(false);
      }
    };
    fetchExistingResults();
  }, [selectedTestId]);

  const filteredLeaderboard = useMemo(() => {
    let result = leaderboard;
    if (isInterviewerMode) {
      result = result.filter(e => e.roundStatus === 'Qualified' || e.roundStatus === 'Waitlisted');
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
    }
    return result;
  }, [leaderboard, isInterviewerMode, searchQuery]);

  return (
    <main style={{ minHeight: '100vh', padding: 'var(--space-xl)' }}>
      <div className="container" style={{ maxWidth: '1200px' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-xl)' }}>
          <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Spectator Dashboard</h1>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => auth.signOut()}
          >
            Sign Out
          </button>
        </div>
        
        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Select Test</h3>
          <div className="form-group">
            <select value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
              <option value="">-- Select a test --</option>
              {tests.map(t => (<option key={t.id} value={t.id}>{t.title}</option>))}
            </select>
          </div>
        </div>

        {selectedTestId && !loading && !resultsDeclared && (
          <div className="alert alert-info">
            Results are not declared yet for this test.
          </div>
        )}

        {loading && <p>Loading results...</p>}

        {resultsDeclared && leaderboard.length > 0 && (
          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
              <div className="flex items-center gap-md">
                <h2 style={{ fontSize: '1.375rem', margin: 0 }}>Leaderboard</h2>
                <button 
                  className={`btn btn-sm ${isInterviewerMode ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setIsInterviewerMode(!isInterviewerMode)}
                >
                  {isInterviewerMode ? 'Interviewer Mode: ON' : 'Interviewer Mode: OFF'}
                </button>
              </div>
              <div className="flex items-center gap-md">
                {isInterviewerMode && (
                  <input
                    type="text"
                    className="input"
                    placeholder="Search candidate name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ width: '250px' }}
                  />
                )}
                <ExcelExport data={filteredLeaderboard as any} filename={`leaderboard_${selectedTestId}.xlsx`} />
              </div>
            </div>
            
            {isInterviewerMode && (
              <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)' }}>
                <strong>Interviewer Mode Active:</strong> Showing only Qualified and Waitlisted candidates. Click "Details" to view the AI review and proctoring flags.
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
  return <RoleGuard requiredRole="Spectator's View"><SpectatorContent /></RoleGuard>;
}
