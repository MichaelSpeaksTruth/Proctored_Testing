'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth } from '@/lib/firebase';
import { formatDateTime } from '@/lib/dateUtils';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle,
  Clock,
  Eye,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  Users,
  X,
  Download,
  Radio,
  Maximize2,
} from 'lucide-react';

export interface ProctorFlag {
  id: string;
  event: string;
  severity: string;
  timestamp: string | number;
  duration?: number;
  snapshot?: string | null;
  detection?: any;
}

export interface CandidateStats {
  uid: string;
  email: string;
  name: string;
  roll?: string;
  status: 'active' | 'submitted' | 'not_started';
  startedAt: string | null;
  submittedAt: string | null;
  lastSeen: string | null;
  flagCount: number;
  highFlags: number;
  mediumFlags: number;
  lowFlags: number;
  latestEvent: string | null;
  latestSnapshot: string | null;
  flags: ProctorFlag[];
}

export interface LiveStatsResponse {
  success: boolean;
  live: boolean;
  message?: string;
  userRole?: string;
  test?: {
    id: string;
    title: string;
    startedAt: string | null;
    scheduledStart: string | null;
  };
  stats?: {
    total: number;
    active: number;
    submitted: number;
    notStarted: number;
    flagged: number;
  };
  candidates?: CandidateStats[];
}

function timeAgo(dateInput: string | number | null | undefined): string {
  if (!dateInput) return '—';
  const time = typeof dateInput === 'number' ? dateInput : new Date(dateInput).getTime();
  if (isNaN(time) || time <= 0) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ${diffMin % 60}m ago`;
}

export default function LiveStatsView({ userRole }: { userRole?: string }) {
  const [data, setData] = useState<LiveStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters & Controls
  const [refreshInterval, setRefreshInterval] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'flagged' | 'submitted' | 'not_started'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium'>('all');

  // Inspection Drawer & Image Viewer
  const [inspectCandidate, setInspectCandidate] = useState<CandidateStats | null>(null);
  const [activeSnapshotModal, setActiveSnapshotModal] = useState<{
    src: string;
    event: string;
    timestamp: string | number;
    candidateName: string;
  } | null>(null);

  // Fetch telemetry from server via Admin SDK
  const fetchLiveStats = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        setError('Session unauthenticated.');
        setLoading(false);
        setIsRefreshing(false);
        return;
      }

      const idToken = await user.getIdToken();
      const res = await fetch('/api/live-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      const json: LiveStatsResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to retrieve live telemetry.');
      }

      setData(json);
      setLastUpdated(new Date());

      if (inspectCandidate) {
        const updated = json.candidates?.find(c => c.uid === inspectCandidate.uid || c.email === inspectCandidate.email);
        if (updated) setInspectCandidate(updated);
      }
    } catch (err: any) {
      console.error('Live telemetry sync error:', err);
      setError(err.message || 'Telemetry connection error.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [inspectCandidate]);

  useEffect(() => {
    fetchLiveStats();
  }, []);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const interval = setInterval(() => {
      fetchLiveStats(true);
    }, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval, fetchLiveStats]);

  const filteredCandidates = useMemo(() => {
    if (!data?.candidates) return [];
    return data.candidates.filter(c => {
      const q = searchQuery.toLowerCase().trim();
      const matches =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.roll && c.roll.toLowerCase().includes(q)) ||
        c.uid.toLowerCase().includes(q);

      if (!matches) return false;
      if (statusFilter === 'active' && c.status !== 'active') return false;
      if (statusFilter === 'submitted' && c.status !== 'submitted') return false;
      if (statusFilter === 'not_started' && c.status !== 'not_started') return false;
      if (statusFilter === 'flagged' && c.flagCount === 0) return false;
      if (severityFilter === 'high' && c.highFlags === 0) return false;
      if (severityFilter === 'medium' && c.mediumFlags === 0 && c.highFlags === 0) return false;

      return true;
    });
  }, [data?.candidates, searchQuery, statusFilter, severityFilter]);

  // Idle state (No active live exam)
  if (!loading && data && !data.live) {
    return (
      <div style={{
        background: 'var(--bg-card, #0f0f0f)',
        border: '1px solid var(--border, #1a1a1a)',
        borderRadius: 'var(--radius-sm, 4px)',
        padding: '40px 24px',
        textAlign: 'center',
        margin: '16px 0',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: 4,
          background: '#141414',
          border: '1px solid #222',
          marginBottom: 16,
        }}>
          <Radio size={20} color="#777" />
        </div>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary, #f5f5f5)', marginBottom: 8, letterSpacing: '-0.01em' }}>
          No Live Examination in Progress
        </h3>
        <p style={{ color: 'var(--text-muted, #666)', maxWidth: 460, margin: '0 auto 20px', fontSize: '0.8125rem', lineHeight: 1.6 }}>
          Telemetry, active proctoring feeds, and candidate statuses synchronize automatically when an examination status is set to Active in the Control Panel.
        </p>
        <button
          onClick={() => fetchLiveStats()}
          disabled={isRefreshing}
          className="btn btn-outline btn-sm"
          style={{ borderRadius: 4 }}
        >
          <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
          <span>Check Status</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ color: 'var(--text-primary, #f5f5f5)' }}>
      {/* ── MISSION CONTROL HEADER BAR ────────────────────────── */}
      <div style={{
        background: 'var(--bg-card, #0f0f0f)',
        border: '1px solid var(--border, #1a1a1a)',
        borderRadius: 'var(--radius-sm, 4px)',
        padding: '16px 20px',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px',
                borderRadius: 2,
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                background: 'rgba(45, 106, 79, 0.25)',
                color: '#52b788',
                border: '1px solid rgba(64, 145, 108, 0.4)',
                fontFamily: 'var(--font-mono, monospace)',
                textTransform: 'uppercase',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 1, background: '#52b788' }} />
                LIVE TELEMETRY
              </span>
              {userRole && (
                <span style={{
                  fontSize: '0.6875rem',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-muted, #777)',
                  background: '#161616',
                  padding: '2px 6px',
                  borderRadius: 2,
                  border: '1px solid #222',
                }}>
                  {userRole}
                </span>
              )}
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary, #f5f5f5)', letterSpacing: '-0.02em' }}>
              {data?.test?.title || 'Active Examination'}
            </h2>
            {data?.test?.startedAt && (
              <p style={{ color: 'var(--text-muted, #666)', fontSize: '0.75rem', marginTop: 4, fontFamily: 'var(--font-mono, monospace)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={12} color="#666" />
                Started: {formatDateTime(data.test.startedAt)}
              </p>
            )}
          </div>

          {/* Sync Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#0a0a0a',
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid var(--border, #1a1a1a)',
            }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #666)', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>
                Auto-Sync:
              </span>
              <select
                value={refreshInterval}
                onChange={e => setRefreshInterval(Number(e.target.value))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#52b788',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono, monospace)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value={0} style={{ background: '#111', color: '#fff' }}>OFF</option>
                <option value={5} style={{ background: '#111', color: '#fff' }}>5s</option>
                <option value={10} style={{ background: '#111', color: '#fff' }}>10s</option>
                <option value={30} style={{ background: '#111', color: '#fff' }}>30s</option>
              </select>
            </div>

            <button
              onClick={() => fetchLiveStats(true)}
              disabled={isRefreshing}
              className="btn btn-outline btn-sm"
              style={{ borderRadius: 4, padding: '6px 12px', fontSize: '0.75rem' }}
              title="Force sync telemetry"
            >
              <RefreshCw size={12} className={isRefreshing ? 'spin' : ''} />
              <span>{isRefreshing ? 'SYNCING' : 'SYNC NOW'}</span>
            </button>
          </div>
        </div>

        {/* ── METRIC HUD ────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
          marginTop: 16,
        }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 4, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#666', fontSize: '0.6875rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
              <span>Registered</span>
              <Users size={13} color="#555" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f5f5f5', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
              {data?.stats?.total ?? 0}
            </div>
          </div>

          <div style={{ background: '#0a0a0a', border: '1px solid rgba(45, 106, 79, 0.4)', borderRadius: 4, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#52b788', fontSize: '0.6875rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
              <span>In Test (Active)</span>
              <Activity size={13} color="#52b788" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#52b788', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
              {data?.stats?.active ?? 0}
            </div>
          </div>

          <div style={{ background: '#0a0a0a', border: '1px solid #1e293b', borderRadius: 4, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#60a5fa', fontSize: '0.6875rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
              <span>Submitted</span>
              <CheckCircle size={13} color="#60a5fa" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#60a5fa', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
              {data?.stats?.submitted ?? 0}
            </div>
          </div>

          <div style={{ background: '#0a0a0a', border: '1px solid rgba(155, 34, 38, 0.4)', borderRadius: 4, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#ff6b6b', fontSize: '0.6875rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
              <span>Flagged</span>
              <ShieldAlert size={13} color="#ff6b6b" />
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ff6b6b', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
              {data?.stats?.flagged ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* ── SEARCH & FILTERS BAR ────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
      }}>
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
          <Search size={14} color="#666" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search candidate name, email, roll, or UID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: '#0a0a0a',
              border: '1px solid var(--border, #1a1a1a)',
              borderRadius: 4,
              padding: '7px 10px 7px 32px',
              color: 'var(--text-primary, #f5f5f5)',
              fontSize: '0.8125rem',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>

        {/* Status filter buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {(['all', 'active', 'flagged', 'submitted', 'not_started'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                background: statusFilter === f ? '#222' : '#0a0a0a',
                color: statusFilter === f ? '#fff' : 'var(--text-muted, #777)',
                border: statusFilter === f ? '1px solid #444' : '1px solid var(--border, #1a1a1a)',
                padding: '5px 10px',
                borderRadius: 3,
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
                textTransform: 'uppercase',
                transition: 'none',
              }}
            >
              {f === 'not_started' ? 'NOT STARTED' : f.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Severity filter buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>Risk:</span>
          {(['all', 'high', 'medium'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              style={{
                background: severityFilter === s ? '#222' : '#0a0a0a',
                color: severityFilter === s ? (s === 'high' ? '#ff6b6b' : s === 'medium' ? '#f4a261' : '#fff') : 'var(--text-muted, #777)',
                border: severityFilter === s ? '1px solid #444' : '1px solid var(--border, #1a1a1a)',
                padding: '4px 8px',
                borderRadius: 3,
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono, monospace)',
                textTransform: 'uppercase',
              }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── ERROR NOTICE ────────────────────────────────────────── */}
      {error && (
        <div style={{
          background: 'rgba(155, 34, 38, 0.15)',
          border: '1px solid rgba(174, 32, 18, 0.4)',
          color: '#ff6b6b',
          padding: '10px 14px',
          borderRadius: 4,
          marginBottom: 14,
          fontSize: '0.8125rem',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          {error}
        </div>
      )}

      {/* ── CANDIDATE ROSTER GRID ──────────────────────────────── */}
      {filteredCandidates.length === 0 ? (
        <div style={{
          background: 'var(--bg-card, #0f0f0f)',
          border: '1px solid var(--border, #1a1a1a)',
          borderRadius: 4,
          padding: '36px',
          textAlign: 'center',
          color: 'var(--text-muted, #666)',
          fontSize: '0.8125rem',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          NO CANDIDATES MATCH SELECTION CRITERIA
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
          gap: 12,
        }}>
          {filteredCandidates.map(c => {
            const isHighRisk = c.highFlags > 0;
            const isMediumRisk = c.mediumFlags > 0;
            const hasSnapshots = Boolean(c.latestSnapshot) || c.flags.some(f => Boolean(f.snapshot));

            return (
              <div
                key={c.uid || c.email}
                style={{
                  background: 'var(--bg-card, #0f0f0f)',
                  border: isHighRisk
                    ? '1px solid rgba(155, 34, 38, 0.6)'
                    : isMediumRisk
                    ? '1px solid rgba(181, 136, 27, 0.5)'
                    : '1px solid var(--border, #1a1a1a)',
                  borderRadius: 4,
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  {/* Status & Last Seen Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    {c.status === 'active' ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 6px',
                        borderRadius: 2,
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        background: 'rgba(45, 106, 79, 0.25)',
                        color: '#52b788',
                        border: '1px solid rgba(64, 145, 108, 0.4)',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: 1, background: '#52b788' }} />
                        TAKING TEST
                      </span>
                    ) : c.status === 'submitted' ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 6px',
                        borderRadius: 2,
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        background: 'rgba(30, 41, 59, 0.6)',
                        color: '#60a5fa',
                        border: '1px solid rgba(96, 165, 250, 0.3)',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        SUBMITTED
                      </span>
                    ) : (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '2px 6px',
                        borderRadius: 2,
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        background: '#161616',
                        color: '#777',
                        border: '1px solid #242424',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        NOT STARTED
                      </span>
                    )}

                    <span style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>
                      LAST SEEN: {timeAgo(c.lastSeen || c.submittedAt || c.startedAt)}
                    </span>
                  </div>

                  {/* Candidate Identity */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary, #f5f5f5)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <User size={13} color="#777" />
                      <span>{c.name}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', marginTop: 2, wordBreak: 'break-all', fontFamily: 'var(--font-mono, monospace)' }}>
                      {c.email}
                    </div>
                    {c.roll && (
                      <div style={{ fontSize: '0.7rem', color: '#888', marginTop: 1, fontFamily: 'var(--font-mono, monospace)' }}>
                        Roll: {c.roll}
                      </div>
                    )}
                  </div>

                  {/* ── LIVE PROCTORING SNAPSHOT PROOF FRAME ─────── */}
                  {c.latestSnapshot && (
                    <div
                      onClick={() => setActiveSnapshotModal({
                        src: c.latestSnapshot!,
                        event: c.latestEvent || 'Active Infraction Proof',
                        timestamp: c.lastSeen || new Date().toISOString(),
                        candidateName: c.name,
                      })}
                      style={{
                        width: '100%',
                        height: 128,
                        background: '#000',
                        border: '1px solid #282828',
                        borderRadius: 3,
                        marginBottom: 10,
                        overflow: 'hidden',
                        position: 'relative',
                        cursor: 'pointer',
                      }}
                      title="Click to view full resolution snapshot"
                    >
                      <img
                        src={c.latestSnapshot}
                        alt="Latest Camera Snapshot"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <div style={{
                        position: 'absolute',
                        bottom: 4,
                        right: 6,
                        background: 'rgba(0,0,0,0.8)',
                        color: '#f5f5f5',
                        fontSize: '0.625rem',
                        padding: '2px 6px',
                        borderRadius: 2,
                        fontFamily: 'var(--font-mono, monospace)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                        <Maximize2 size={10} />
                        ZOOM PROOF
                      </div>
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        left: 6,
                        background: 'rgba(0,0,0,0.75)',
                        color: '#52b788',
                        fontSize: '0.6rem',
                        padding: '1px 5px',
                        borderRadius: 2,
                        fontFamily: 'var(--font-mono, monospace)',
                        textTransform: 'uppercase',
                      }}>
                        📷 CAPTURED PROOF
                      </div>
                    </div>
                  )}

                  {/* Telemetry Flags Block */}
                  <div style={{
                    background: '#0a0a0a',
                    border: '1px solid #1a1a1a',
                    borderRadius: 3,
                    padding: '8px 10px',
                    marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.6875rem', color: '#666', fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>Infractions:</span>
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono, monospace)',
                        color: c.flagCount > 0 ? (isHighRisk ? '#ff6b6b' : '#f4a261') : '#52b788',
                      }}>
                        {c.flagCount} {c.flagCount === 1 ? 'FLAG' : 'FLAGS'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.highFlags > 0 && (
                        <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 2, background: 'rgba(155, 34, 38, 0.25)', color: '#ff6b6b', border: '1px solid rgba(174, 32, 18, 0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
                          {c.highFlags} HIGH
                        </span>
                      )}
                      {c.mediumFlags > 0 && (
                        <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 2, background: 'rgba(124, 92, 30, 0.25)', color: '#f4a261', border: '1px solid rgba(181, 136, 27, 0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
                          {c.mediumFlags} MED
                        </span>
                      )}
                      {c.lowFlags > 0 && (
                        <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 2, background: '#1c1c1c', color: '#888', fontFamily: 'var(--font-mono, monospace)' }}>
                          {c.lowFlags} LOW
                        </span>
                      )}
                      {c.flagCount === 0 && (
                        <span style={{ fontSize: '0.6875rem', color: '#52b788', fontFamily: 'var(--font-mono, monospace)' }}>
                          CLEAN TELEMETRY
                        </span>
                      )}
                    </div>

                    {c.latestEvent && (
                      <div style={{ fontSize: '0.6875rem', color: '#aaa', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={11} color={isHighRisk ? '#ff6b6b' : '#f4a261'} />
                        <span style={{ color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>LATEST:</span>
                        <span style={{ color: '#f5f5f5' }}>{c.latestEvent}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setInspectCandidate(c)}
                    style={{
                      flex: 1,
                      background: '#141414',
                      border: '1px solid #282828',
                      color: 'var(--text-primary, #f5f5f5)',
                      padding: '6px 10px',
                      borderRadius: 3,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono, monospace)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Eye size={12} />
                    INSPECT ({c.flagCount})
                  </button>

                  {hasSnapshots && (
                    <button
                      onClick={() => setInspectCandidate(c)}
                      style={{
                        background: 'rgba(124, 92, 30, 0.2)',
                        border: '1px solid rgba(181, 136, 27, 0.45)',
                        color: '#f4a261',
                        padding: '6px 10px',
                        borderRadius: 3,
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono, monospace)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="Inspect captured proof snapshots"
                    >
                      <Camera size={12} />
                      PROOFS
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── INSPECTION DRAWER ───────────────────────────────────── */}
      {inspectCandidate && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16,
        }}>
          <div style={{
            background: 'var(--bg-card, #0f0f0f)',
            border: '1px solid var(--border-light, #252525)',
            borderRadius: 4,
            width: '100%',
            maxWidth: 780,
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border, #1a1a1a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f5f5f5', letterSpacing: '-0.01em' }}>
                  Proctoring Telemetry: {inspectCandidate.name}
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'var(--font-mono, monospace)' }}>
                  {inspectCandidate.email} {inspectCandidate.roll ? `• Roll: ${inspectCandidate.roll}` : ''} • UID: {inspectCandidate.uid}
                </span>
              </div>
              <button
                onClick={() => setInspectCandidate(null)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
              {/* Metric Row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginBottom: 16,
              }}>
                <div style={{ background: '#0a0a0a', padding: '8px 12px', borderRadius: 3, border: '1px solid #1c1c1c' }}>
                  <div style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>STATUS</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f5f5f5', marginTop: 2, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase' }}>
                    {inspectCandidate.status.replace('_', ' ')}
                  </div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '8px 12px', borderRadius: 3, border: '1px solid #1c1c1c' }}>
                  <div style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>FLAGS</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#f4a261', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
                    {inspectCandidate.flagCount}
                  </div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '8px 12px', borderRadius: 3, border: '1px solid #1c1c1c' }}>
                  <div style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>HIGH RISK</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#ff6b6b', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
                    {inspectCandidate.highFlags}
                  </div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '8px 12px', borderRadius: 3, border: '1px solid #1c1c1c' }}>
                  <div style={{ fontSize: '0.65rem', color: '#666', fontFamily: 'var(--font-mono, monospace)' }}>LAST SEEN</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#52b788', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
                    {timeAgo(inspectCandidate.lastSeen)}
                  </div>
                </div>
              </div>

              <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#888', marginBottom: 10, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Infraction Logs &amp; Evidence Snapshots ({inspectCandidate.flags.length})
              </h4>

              {inspectCandidate.flags.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#666', background: '#0a0a0a', borderRadius: 3, border: '1px solid #1a1a1a', fontSize: '0.8125rem', fontFamily: 'var(--font-mono, monospace)' }}>
                  NO INFRACTIONS RECORDED
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inspectCandidate.flags.map(f => (
                    <div
                      key={f.id}
                      style={{
                        background: '#0a0a0a',
                        border: f.severity === 'high' ? '1px solid rgba(155, 34, 38, 0.5)' : '1px solid #1c1c1c',
                        borderRadius: 3,
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 14,
                      }}
                    >
                      {f.snapshot ? (
                        <div
                          onClick={() => setActiveSnapshotModal({
                            src: f.snapshot!,
                            event: f.event,
                            timestamp: f.timestamp,
                            candidateName: inspectCandidate.name,
                          })}
                          style={{
                            width: 100,
                            height: 70,
                            borderRadius: 2,
                            overflow: 'hidden',
                            position: 'relative',
                            cursor: 'pointer',
                            border: '1px solid #333',
                            flexShrink: 0,
                            background: '#000',
                          }}
                          title="Click to view full snapshot"
                        >
                          <img
                            src={f.snapshot}
                            alt="Infraction Evidence"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <div style={{
                            position: 'absolute',
                            bottom: 2,
                            right: 4,
                            background: 'rgba(0,0,0,0.8)',
                            padding: '1px 4px',
                            borderRadius: 2,
                            fontSize: '0.55rem',
                            color: '#fff',
                            fontFamily: 'var(--font-mono, monospace)',
                          }}>
                            ZOOM
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          width: 100,
                          height: 70,
                          borderRadius: 2,
                          background: '#121212',
                          border: '1px dashed #242424',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#555',
                          fontSize: '0.625rem',
                          fontFamily: 'var(--font-mono, monospace)',
                          flexShrink: 0,
                          textAlign: 'center',
                          padding: 4,
                        }}>
                          NO CAMERA CAPTURE
                        </div>
                      )}

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f5f5f5' }}>
                            {f.event}
                          </span>
                          <span style={{
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 2,
                            background: f.severity === 'high' ? 'rgba(155, 34, 38, 0.3)' : 'rgba(124, 92, 30, 0.3)',
                            color: f.severity === 'high' ? '#ff6b6b' : '#f4a261',
                            border: f.severity === 'high' ? '1px solid rgba(174, 32, 18, 0.4)' : '1px solid rgba(181, 136, 27, 0.4)',
                            fontFamily: 'var(--font-mono, monospace)',
                            textTransform: 'uppercase',
                          }}>
                            {f.severity}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.72rem', color: '#777', fontFamily: 'var(--font-mono, monospace)', display: 'flex', gap: 12 }}>
                          <span>Time: {formatDateTime(f.timestamp)}</span>
                          {f.duration !== undefined && f.duration > 0 && <span>Duration: {f.duration}s</span>}
                        </div>

                        {f.detection && (
                          <div style={{ fontSize: '0.6875rem', color: '#999', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
                            Metadata: {JSON.stringify(f.detection)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HIGH RESOLUTION PROOF MODAL ─────────────────────────── */}
      {activeSnapshotModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.92)',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            maxWidth: 840,
            width: '100%',
            background: 'var(--bg-card, #0f0f0f)',
            border: '1px solid var(--border-light, #252525)',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border, #1a1a1a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f5f5f5' }}>
                  {activeSnapshotModal.event}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#777', marginLeft: 12, fontFamily: 'var(--font-mono, monospace)' }}>
                  {activeSnapshotModal.candidateName} • {formatDateTime(activeSnapshotModal.timestamp)}
                </span>
              </div>
              <button
                onClick={() => setActiveSnapshotModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 8, display: 'flex', justifyContent: 'center', background: '#050505' }}>
              <img
                src={activeSnapshotModal.src}
                alt="Infraction Evidence Proof"
                style={{ maxWidth: '100%', maxHeight: '68vh', objectFit: 'contain' }}
              />
            </div>
            <div style={{ padding: '8px 16px', background: '#0a0a0a', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border, #1a1a1a)' }}>
              <a
                href={activeSnapshotModal.src}
                download={`proof_${activeSnapshotModal.candidateName}_${Date.now()}.jpg`}
                className="btn btn-outline btn-sm"
                style={{ borderRadius: 3, padding: '5px 12px', fontSize: '0.72rem', fontFamily: 'var(--font-mono, monospace)' }}
              >
                <Download size={12} />
                DOWNLOAD PROOF
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
