'use client';

import { useState, Fragment } from 'react';
import { calculateIntegrityScore, DurationFlag } from '@/lib/proctoring';
import { formatDateTime } from '@/lib/dateUtils';

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
  flags?: { 
    event: string; 
    severity: string; 
    timestamp?: string; 
    startTime?: string; 
    endTime?: string;
    durationInSeconds?: number;
    evidenceSnapshot?: string;
  }[];
  integrityScore?: number;
  interviewScheduled?: boolean;
  panelNo?: string;
  venue?: string;
  dateTime?: string;
  // Integrity flags from grade-test
  integrityFlag?: string;
  delaySeconds?: number;
  flagNote?: string;
}

interface Props {
  entries: LeaderboardEntry[];
  onAnalyze?: (uid: string) => void;
  analyzing?: string | null;
  onDelete?: (uid: string) => void;
  onUpdateRoundStatus?: (uid: string, status: string) => void;
  onEditInfo?: (uid: string) => void;
}

const PAGE_SIZE = 20;

export default function LeaderboardTable({ entries, onAnalyze, analyzing, onDelete, onUpdateRoundStatus, onEditInfo }: Props) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<{ src: string; title: string } | null>(null);

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const severityBadge = (s?: string) => {
    if (!s) return <span className="badge badge-gray">Not Analyzed</span>;
    if (s === 'low') return <span className="badge badge-green">Low Risk</span>;
    if (s === 'medium') return <span className="badge badge-amber">Medium Risk</span>;
    return <span className="badge badge-red">High Risk</span>;
  };

  const getScoreBadge = (score: number) => {
    if (score >= 85) {
      return (
        <span 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: 4, 
            padding: '2px 7px', 
            borderRadius: 2, 
            fontSize: '0.6875rem', 
            fontWeight: 600,
            letterSpacing: '0.04em',
            background: 'rgba(34, 197, 94, 0.15)', 
            color: '#4ade80',
            border: '1px solid rgba(34, 197, 94, 0.3)'
          }}
        >
          {score}% Trust
        </span>
      );
    }
    if (score >= 65) {
      return (
        <span 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: 4, 
            padding: '2px 7px', 
            borderRadius: 2, 
            fontSize: '0.6875rem', 
            fontWeight: 600,
            letterSpacing: '0.04em',
            background: 'rgba(245, 158, 11, 0.15)', 
            color: '#fbbf24',
            border: '1px solid rgba(245, 158, 11, 0.3)'
          }}
        >
          {score}% Moderate
        </span>
      );
    }
    return (
      <span 
        style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: 4, 
          padding: '2px 7px', 
          borderRadius: 2, 
          fontSize: '0.6875rem', 
          fontWeight: 600,
          letterSpacing: '0.04em',
          background: 'rgba(239, 68, 68, 0.15)', 
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.3)'
        }}
      >
        {score}% Flagged
      </span>
    );
  };

  const rankStyle = (rank: number) => {
    if (rank === 1) return { className: 'rank-1', symbol: '1' };
    if (rank === 2) return { className: 'rank-2', symbol: '2' };
    if (rank === 3) return { className: 'rank-3', symbol: '3' };
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
              <th>Integrity</th>
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
              const computedScore = entry.integrityScore ?? calculateIntegrityScore((entry.flags || []) as DurationFlag[]);

              return (
                <Fragment key={entry.uid}>
                  <tr>
                    <td data-label="Rank">
                      <span className={rs.className} style={{ fontWeight: rs.className ? 700 : 400 }}>{rs.symbol}</span>
                    </td>
                    <td data-label="Name" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {entry.name}
                      {entry.integrityFlag === 'DELAYED_SUBMISSION' && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-red" style={{ fontSize: '0.7rem', letterSpacing: '0.04em' }}>
                            DELAYED +{entry.delaySeconds}s
                          </span>
                        </div>
                      )}
                    </td>
                    <td data-label="Email" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>{entry.email}</td>
                    <td data-label="Score" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {entry.score}/{entry.total}
                    </td>
                    <td data-label="Integrity">
                      {getScoreBadge(computedScore)}
                    </td>
                    <td data-label="Flags">
                      <span
                        className={`badge ${entry.flagCount > 5 ? 'badge-red' : entry.flagCount > 2 ? 'badge-amber' : 'badge-gray'}`}
                      >
                        {entry.flagCount} flags
                      </span>
                    </td>
                    <td data-label="AI Risk">{severityBadge(entry.aiSeverity)}</td>
                    <td data-label="Round Status">
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
                    <td data-label="Actions">
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
                        {onAnalyze && !entry.aiSeverity && (
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
                        colSpan={9}
                        style={{ background: 'var(--bg-secondary)', padding: 'var(--space-lg)' }}
                      >
                        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Integrity Index: {computedScore}/100
                          </span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                            Total Violations Logged: {entry.flags?.length || 0}
                          </span>
                        </div>

                        {entry.aiSummary && (
                          <div className="alert alert-info" style={{ marginBottom: 'var(--space-md)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            <strong>AI Proctoring Verdict:</strong> {entry.aiSummary}
                          </div>
                        )}

                        {entry.dateTime && (
                          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: '0.8125rem', color: '#fbbf24', fontWeight: 600 }}>Interview Schedule: </span>
                            <span style={{ fontSize: '0.8125rem', color: '#ffffff', fontWeight: 600 }}>{entry.dateTime}</span>
                            {entry.venue && <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: 10 }}>· Venue: {entry.venue}</span>}
                            {entry.panelNo && <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: 10 }}>· Panel: {entry.panelNo}</span>}
                          </div>
                        )}
                        
                        {entry.flags && entry.flags.length > 0 ? (
                          <div>
                            <h4 style={{ marginBottom: 12, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                              Telemetry & Flag Log (With Snapshot Proof)
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 10 }}>
                              {entry.flags.map((f, i) => (
                                <div
                                  key={i}
                                  style={{
                                    padding: '10px 12px',
                                    background: 'var(--bg-card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.8125rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span
                                      style={{
                                        fontWeight: 700,
                                        fontFamily: 'var(--font-mono)',
                                        color: f.severity === 'critical' ? 'var(--accent-red-light)' : f.severity === 'high' ? '#f4a261' : 'var(--text-muted)',
                                      }}
                                    >
                                      [{f.severity.toUpperCase()}] {f.event}
                                    </span>
                                    {f.durationInSeconds !== undefined && (
                                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.75rem' }}>
                                        {f.durationInSeconds}s
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                                    <span style={{ color: '#ffffff', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                      {formatDateTime(f.startTime || f.timestamp, 'numeric', true)}
                                    </span>

                                    {/* Visual Evidence Snapshot Button */}
                                    {f.evidenceSnapshot && (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewSnapshot({ src: f.evidenceSnapshot!, title: `${f.event} (${f.durationInSeconds || 0}s)` })}
                                        style={{
                                          background: 'rgba(59, 130, 246, 0.15)',
                                          border: '1px solid rgba(59, 130, 246, 0.35)',
                                          color: '#60a5fa',
                                          borderRadius: 4,
                                          padding: '2px 8px',
                                          cursor: 'pointer',
                                          fontSize: '0.72rem',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 4
                                        }}
                                      >
                                        View Proof
                                      </button>
                                    )}
                                  </div>
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
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Snapshot Preview Modal */}
      {previewSnapshot && (
        <div 
          onClick={() => setPreviewSnapshot(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card, #111827)',
              border: '1px solid var(--border, #374151)',
              borderRadius: 8,
              padding: 16,
              maxWidth: 480,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                Evidence Frame: {previewSnapshot.title}
              </span>
              <button 
                className="btn btn-ghost btn-sm"
                onClick={() => setPreviewSnapshot(null)}
                style={{ padding: '2px 8px' }}
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={previewSnapshot.src} 
              alt="Violation evidence" 
              style={{ width: '100%', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
              Webcam snapshot captured automatically at violation onset.
            </p>
          </div>
        </div>
      )}

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
