'use client';

import { useState } from 'react';

export interface LeaderboardEntry {
  uid: string;
  name: string;
  email: string;
  score: number;
  total: number;
  rank: number;
  roundStatus: string;
  flagCount: number;
  aiSeverity?: string;
  aiSummary?: string;
  flags?: { event: string; severity: string; timestamp?: string; startTime?: string }[];
  interviewScheduled?: boolean;
  panelNo?: string;
  venue?: string;
  dateTime?: string;
}

interface Props {
  entries: LeaderboardEntry[];
  onAnalyze: (uid: string) => void;
  analyzing: string | null;
  onDelete?: (uid: string) => void;
  onUpdateRoundStatus?: (uid: string, status: string) => void;
  onEditInfo?: (uid: string) => void;
}

const PAGE_SIZE = 20;

export default function LeaderboardTable({ entries, onAnalyze, analyzing, onDelete, onUpdateRoundStatus, onEditInfo }: Props) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const severityBadge = (s?: string) => {
    if (!s) return <span className="badge badge-gray">Not Analyzed</span>;
    if (s === 'low') return <span className="badge badge-green">Low Risk</span>;
    if (s === 'medium') return <span className="badge badge-amber">Medium Risk</span>;
    return <span className="badge badge-red">High Risk</span>;
  };

  const rankStyle = (rank: number) => {
    if (rank === 1) return { className: 'rank-1', symbol: '🥇 1' };
    if (rank === 2) return { className: 'rank-2', symbol: '🥈 2' };
    if (rank === 3) return { className: 'rank-3', symbol: '🥉 3' };
    return { className: '', symbol: String(rank) };
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table id="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Email</th>
              <th>Score</th>
              <th>Flags</th>
              <th>AI Risk</th>
              <th>Round Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((entry) => {
              const rs = rankStyle(entry.rank);
              const isExpanded = expanded === entry.uid;
              return (
                <>
                  <tr key={entry.uid}>
                    <td>
                      <span className={rs.className} style={{ fontWeight: rs.className ? 700 : 400 }}>{rs.symbol}</span>
                    </td>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{entry.name}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>{entry.email}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {entry.score}/{entry.total}
                    </td>
                    <td>
                      <span
                        className={`badge ${entry.flagCount > 5 ? 'badge-red' : entry.flagCount > 2 ? 'badge-amber' : 'badge-gray'}`}
                      >
                        {entry.flagCount} flags
                      </span>
                    </td>
                    <td>{severityBadge(entry.aiSeverity)}</td>
                    <td>
                      {onUpdateRoundStatus ? (
                        <select
                          id={`table-round-status-${entry.uid}`}
                          value={entry.roundStatus || 'Pending'}
                          onChange={e => onUpdateRoundStatus(entry.uid, e.target.value)}
                          style={{ width: 110, fontSize: '0.8125rem', padding: '4px 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                        >
                          <option>Pending</option>
                          <option>Qualified</option>
                          <option>Eliminated</option>
                          <option>Waitlisted</option>
                        </select>
                      ) : (
                        <span className="badge badge-gray">{entry.roundStatus || 'Pending'}</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          id={`expand-${entry.uid}`}
                          onClick={() => setExpanded(isExpanded ? null : entry.uid)}
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                        {onEditInfo && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => onEditInfo(entry.uid)}
                          >
                            Edit Info
                          </button>
                        )}
                        {!entry.aiSeverity && (
                          <button
                            className="btn btn-outline btn-sm"
                            id={`analyze-${entry.uid}`}
                            onClick={() => onAnalyze(entry.uid)}
                            disabled={analyzing === entry.uid}
                          >
                            {analyzing === entry.uid ? 'Analyzing...' : 'AI Review'}
                          </button>
                        )}
                        {onDelete && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--accent-red-light)' }}
                            onClick={() => onDelete(entry.uid)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entry.uid}-expand`}>
                      <td
                        colSpan={8}
                        style={{ background: 'var(--bg-secondary)', padding: 'var(--space-lg)' }}
                      >
                        {entry.aiSummary && (
                          <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            <strong>AI Analysis:</strong> {entry.aiSummary}
                          </div>
                        )}
                        {entry.flags && entry.flags.length > 0 ? (
                          <div>
                            <h4 style={{ marginBottom: 12, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Proctoring Log</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                              {entry.flags.slice(-20).map((f, i) => (
                                <div
                                  key={i}
                                  style={{
                                    padding: '8px 12px',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.8125rem',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                >
                                  <span
                                    style={{
                                      color: f.severity === 'critical' ? 'var(--accent-red-light)' : f.severity === 'high' ? '#f4a261' : 'var(--text-muted)',
                                    }}
                                  >
                                    [{f.severity.toUpperCase()}]
                                  </span>{' '}
                                  {f.event}{' '}
                                  <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                                    {new Date(f.startTime || f.timestamp || '').toLocaleTimeString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-muted)' }}>No proctoring events recorded.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-lg)', padding: '0 var(--space-sm)' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, entries.length)} of {entries.length} students
          </span>
          <div className="flex gap-sm">
            <button
              className="btn btn-outline btn-sm"
              id="leaderboard-prev"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i}
                className={`btn btn-sm ${page === i ? 'btn-primary' : 'btn-ghost'}`}
                id={`leaderboard-page-${i}`}
                onClick={() => setPage(i)}
              >
                {i + 1}
              </button>
            ))}
            <button
              className="btn btn-outline btn-sm"
              id="leaderboard-next"
              disabled={page === totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
