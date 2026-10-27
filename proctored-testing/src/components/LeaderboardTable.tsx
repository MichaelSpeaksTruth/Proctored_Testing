'use client';

import { useState, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
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
  roll?: string;
  rollNumber?: string;
}

export interface SnapshotPreviewData {
  src: string;
  charges: string;
  duration?: number;
  timestamp?: string;
  studentName: string;
  studentRoll: string;
  studentEmail: string;
  count: number;
}

export const getStudentRollNumber = (entry: LeaderboardEntry): string => {
  if (entry.roll && entry.roll.trim()) return entry.roll.trim();
  if (entry.rollNumber && entry.rollNumber.trim()) return entry.rollNumber.trim();
  
  const email = (entry.email || '').toLowerCase().trim();
  const [username, domain] = email.split('@');
  
  // Academic / institutional domains (e.g. bitmesra.ac.in, somename.edu, .ac.in, etc.)
  if (domain && !['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com'].includes(domain)) {
    if (username && username.length > 2) return username;
  }
  
  // Specific pattern for roll numbers with prefix + numbers (e.g. btech10199.26, 2021001, cs21b01)
  if (/^(btech|mtech|bca|mca|be|me|ug|pg|[a-z]{2,4})\d+[\w.]*$/i.test(username) || /^\d{5,}$/.test(username)) {
    return username;
  }
  
  return 'NA';
};

export const getSnapshotDownloadName = (snap: SnapshotPreviewData): string => {
  const sanitize = (val: string) => (val || '').replace(/[/\\?%*:|"<>]/g, '').trim().replace(/\s+/g, '_');
  const name = sanitize(snap.studentName) || 'student';
  const roll = sanitize(snap.studentRoll) || 'NA';
  const email = sanitize(snap.studentEmail) || 'email';
  const charges = sanitize(snap.charges) || 'VIOLATION';
  const count = snap.count || 1;
  return `${name}_${roll}_${email}_(${charges})_${count}.jpeg`;
};

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
  const [mounted, setMounted] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<SnapshotPreviewData | null>(null);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!previewSnapshot) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewSnapshot(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = origOverflow;
    };
  }, [previewSnapshot]);

  const handleDownloadSnapshot = async (snap: SnapshotPreviewData) => {
    const filename = getSnapshotDownloadName(snap);
    try {
      let finalDataUrl = snap.src;

      if (!snap.src.startsWith('data:image/jpeg')) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image failed to load for conversion'));
            img.src = snap.src;
          });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 320;
          canvas.height = img.naturalHeight || img.height || 240;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);
          }
        } catch (err) {
          console.warn('Canvas conversion fallback, using original src:', err);
          finalDataUrl = snap.src;
        }
      }

      const a = document.createElement('a');
      a.href = finalDataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } catch (err) {
      console.error('Download error:', err);
      const a = document.createElement('a');
      a.href = snap.src;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    }
  };

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
                        {onAnalyze && (
                          <button
                            className="btn btn-outline btn-sm"
                            id={`analyze-${entry.uid}`}
                            onClick={() => onAnalyze(entry.uid)}
                            disabled={analyzing === entry.uid}
                            title={entry.aiSeverity ? 'Re-run AI analysis on proctoring flags' : 'Run on-demand AI integrity review'}
                          >
                            {analyzing === entry.uid ? 'Analyzing...' : entry.aiSeverity ? 'Re-review' : 'AI Review'}
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
                                    {f.evidenceSnapshot && (() => {
                                      const studentRoll = getStudentRollNumber(entry);
                                      const snapshotData: SnapshotPreviewData = {
                                        src: f.evidenceSnapshot!,
                                        charges: f.event,
                                        duration: f.durationInSeconds,
                                        timestamp: f.startTime || f.timestamp,
                                        studentName: entry.name,
                                        studentRoll,
                                        studentEmail: entry.email,
                                        count: i + 1,
                                      };
                                      return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setIsImageLoading(true);
                                              setDownloadSuccess(false);
                                              setPreviewSnapshot(snapshotData);
                                            }}
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
                                              gap: 5,
                                              fontWeight: 500
                                            }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                              <circle cx="12" cy="12" r="3" />
                                            </svg>
                                            View Proof
                                          </button>
                                          <button
                                            type="button"
                                            title={`Download: ${getSnapshotDownloadName(snapshotData)}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDownloadSnapshot(snapshotData);
                                            }}
                                            style={{
                                              background: 'rgba(255, 255, 255, 0.08)',
                                              border: '1px solid rgba(255, 255, 255, 0.16)',
                                              color: '#cbd5e1',
                                              borderRadius: 4,
                                              padding: '2px 6px',
                                              cursor: 'pointer',
                                              fontSize: '0.72rem',
                                              display: 'inline-flex',
                                              alignItems: 'center'
                                            }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                              <polyline points="7 10 12 15 17 10" />
                                              <line x1="12" y1="15" x2="12" y2="3" />
                                            </svg>
                                          </button>
                                        </div>
                                      );
                                    })()}
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

      {/* Snapshot Preview Modal — Rendered into document.body via Portal to escape parent container constraints */}
      {mounted && previewSnapshot && typeof document !== 'undefined' && createPortal(
        <div 
          role="dialog"
          aria-modal="true"
          aria-label="Proctoring Visual Evidence Frame"
          onClick={() => setPreviewSnapshot(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
            overflowY: 'auto'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0e131f',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 12,
              boxShadow: '0 25px 70px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.08)',
              maxWidth: 540,
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              margin: 'auto'
            }}
          >
            {/* Top Bar ("over all on top") with Details, Download Button, and Cross Button */}
            <div 
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff', letterSpacing: '-0.01em' }}>
                    Evidence: {previewSnapshot.charges}
                  </span>
                  {previewSnapshot.duration !== undefined && previewSnapshot.duration > 0 && (
                    <span style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#f87171',
                      fontSize: '0.72rem',
                      padding: '2px 7px',
                      borderRadius: 4,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {previewSnapshot.duration}s
                    </span>
                  )}
                  <span style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#94a3b8',
                    fontSize: '0.72rem',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)'
                  }}>
                    Violation #{previewSnapshot.count}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.78rem',
                  color: '#94a3b8',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  <strong style={{ color: '#f1f5f9' }}>{previewSnapshot.studentName}</strong>
                  {previewSnapshot.studentRoll && previewSnapshot.studentRoll !== 'NA' && (
                    <span> &middot; Roll: {previewSnapshot.studentRoll}</span>
                  )}
                  <span> &middot; {previewSnapshot.studentEmail}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Download Button */}
                <button
                  type="button"
                  onClick={() => handleDownloadSnapshot(previewSnapshot)}
                  title={`Download proof as ${getSnapshotDownloadName(previewSnapshot)}`}
                  style={{
                    background: downloadSuccess ? '#16a34a' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {downloadSuccess ? 'Downloaded!' : 'Download'}
                </button>

                {/* Cross Button */}
                <button 
                  type="button"
                  onClick={() => setPreviewSnapshot(null)}
                  title="Close proof (Esc)"
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 6,
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    lineHeight: 1,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                    e.currentTarget.style.color = '#ffffff';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.color = '#cbd5e1';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Photo Proof Box with Centered Natural Framing */}
            <div 
              style={{
                position: 'relative',
                background: '#040711',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '260px'
              }}
            >
              {isImageLoading && (
                <div 
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    background: '#040711',
                    zIndex: 2
                  }}
                >
                  <div className="spinner" style={{ width: 34, height: 34, borderTopColor: '#3b82f6' }} />
                  <span style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 500 }}>
                    Loading webcam snapshot...
                  </span>
                </div>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={previewSnapshot.src} 
                alt={`Violation evidence: ${previewSnapshot.charges}`}
                onLoad={() => setIsImageLoading(false)}
                onError={() => setIsImageLoading(false)}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '56vh',
                  objectFit: 'contain',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
                  display: isImageLoading ? 'none' : 'block'
                }}
              />
            </div>

            {/* Footer / Filename & Timestamp Preview */}
            <div 
              style={{
                padding: '12px 18px',
                background: 'rgba(0, 0, 0, 0.35)',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: '0.75rem',
                color: '#94a3b8'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#10b981',
                  display: 'inline-block'
                }} />
                <span>Webcam snapshot captured automatically at violation onset</span>
                {previewSnapshot.timestamp && (
                  <span style={{ color: '#ffffff', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    &middot; {formatDateTime(previewSnapshot.timestamp, 'numeric', true)}
                  </span>
                )}
              </div>
              <span 
                title="Download file name format: name_roll_email_(charges)_count.jpeg"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  color: '#60a5fa',
                  background: 'rgba(59, 130, 246, 0.08)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}
              >
                {getSnapshotDownloadName(previewSnapshot)}
              </span>
            </div>
          </div>
        </div>,
        document.body
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
