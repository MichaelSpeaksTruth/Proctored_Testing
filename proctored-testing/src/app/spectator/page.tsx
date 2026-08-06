'use client';

import { useState, useEffect } from 'react';
import { rtdb, auth } from '@/lib/firebase';
import { ref, get } from 'firebase/database';
import RoleGuard from '@/components/RoleGuard';
import ExcelExport from '@/components/ExcelExport';

interface TestOption { id: string; title: string; }

// Use a simplified local version of LeaderboardEntry for spectator view to avoid coupling with admin components
interface SpectatorLeaderboardEntry {
  uid: string;
  name: string;
  email: string;
  score: number;
  total: number;
  rank: number;
  roundStatus?: string;
  aiSeverity?: string;
}

function SpectatorContent() {
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [leaderboard, setLeaderboard] = useState<SpectatorLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultsDeclared, setResultsDeclared] = useState(false);

  useEffect(() => {
    get(ref(rtdb, 'tests')).then(snap => {
      const val = snap.val();
      if (val) {
        setTests(Object.keys(val).map(key => ({ id: key, title: val[key].title || key })));
      }
    });
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
        const resultsSnap = await get(ref(rtdb, `results/${selectedTestId}`));
        const resultsVal = resultsSnap.val();
        if (resultsVal) {
          setResultsDeclared(true);
          const entries: SpectatorLeaderboardEntry[] = [];
          
          for (const uid of Object.keys(resultsVal)) {
            const data = resultsVal[uid];
            entries.push({
              uid,
              name: data.name || 'Unknown Name',
              email: data.email || 'Unknown Email',
              score: data.score,
              total: data.total,
              rank: data.rank,
              roundStatus: data.roundStatus || 'Pending',
              aiSeverity: data.aiSeverity,
            });
          }
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
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
              <h2 style={{ fontSize: '1.375rem' }}>Leaderboard</h2>
              <ExcelExport data={leaderboard as any} filename={`leaderboard_${selectedTestId}.xlsx`} />
            </div>

            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Candidate</th>
                    <th>Score</th>
                    <th>AI Risk</th>
                    <th>Round Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(entry => (
                    <tr key={entry.uid}>
                      <td><div className="badge badge-gray">#{entry.rank}</div></td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{entry.name}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{entry.email}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{entry.score} <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>/ {entry.total}</span></td>
                      <td>
                        {entry.aiSeverity ? (
                          <span className={`badge ${entry.aiSeverity === 'High' ? 'badge-red' : entry.aiSeverity === 'Medium' ? 'badge-yellow' : 'badge-green'}`}>
                            {entry.aiSeverity}
                          </span>
                        ) : (
                          <span className="badge badge-gray">N/A</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${entry.roundStatus === 'Passed' ? 'badge-green' : entry.roundStatus === 'Failed' ? 'badge-red' : 'badge-gray'}`}>
                          {entry.roundStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SpectatorPage() {
  return <RoleGuard requiredRole="Spectator's View"><SpectatorContent /></RoleGuard>;
}
