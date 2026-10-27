'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, get, remove, update } from 'firebase/database';
import { formatDateTime } from '@/lib/dateUtils';
import { onAuthStateChanged } from 'firebase/auth';
import { AuditEvent } from '@/lib/auditLogger';
import { isAdmin } from '@/lib/adminUtils';
import { ApprovedPersonnelInfo, getPersonnelProfile } from '@/lib/tccService';
import RaiseDisputeModal from '@/components/RaiseDisputeModal';
import Link from 'next/link';
import { MessageSquareQuote, ShieldAlert } from 'lucide-react';

interface EventsAuditViewProps {
  embeddedInAdmin?: boolean;
}

function ParticipantRosterViewer({
  list,
  fileName,
  duplicateCount,
}: {
  list: Array<{ name: string; email: string }>;
  fileName?: string;
  duplicateCount?: number;
}) {
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    if (!filter.trim()) return list;
    const q = filter.toLowerCase().trim();
    return list.filter(
      p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q))
    );
  }, [list, filter]);

  const handleCopy = () => {
    const text = list.map(p => `${p.name}, ${p.email}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        marginTop: 10,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-secondary)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--bg-input)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
            Candidate Roster ({list.length} Enrolled)
          </span>
          {duplicateCount !== undefined && duplicateCount > 0 && (
            <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
              {duplicateCount} Duplicates Merged
            </span>
          )}
          {fileName && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Source: {fileName}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search roster..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              padding: '3px 8px',
              fontSize: '0.75rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              width: 150,
            }}
          />
          <button
            type="button"
            onClick={handleCopy}
            className="btn btn-ghost btn-sm"
            style={{ padding: '3px 8px', fontSize: '0.75rem' }}
          >
            {copied ? '✓ Copied' : 'Copy All'}
          </button>
        </div>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78125rem' }}>
          <thead>
            <tr
              style={{
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)',
                color: 'var(--text-muted)',
                textAlign: 'left',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <th style={{ padding: '6px 10px', width: 44 }}>#</th>
              <th style={{ padding: '6px 10px' }}>Name</th>
              <th style={{ padding: '6px 10px' }}>Email</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, idx) => (
              <tr key={p.email + '-' + idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '5px 10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {idx + 1}
                </td>
                <td style={{ padding: '5px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {p.name || 'Unnamed'}
                </td>
                <td style={{ padding: '5px 10px', color: 'var(--accent-green-light)', fontFamily: 'var(--font-mono)' }}>
                  {p.email}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No candidates matching &ldquo;{filter}&rdquo;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EventsAuditView({ embeddedInAdmin = false }: EventsAuditViewProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionCategory, setActionCategory] = useState<string>('ALL');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isSrAdmin, setIsSrAdmin] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<ApprovedPersonnelInfo | null>(null);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeTargetEvent, setDisputeTargetEvent] = useState<AuditEvent | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setIsSrAdmin(isAdmin(u?.email));
      if (u) {
        const prof = await getPersonnelProfile(u);
        setCurrentUserProfile(prof);
      } else {
        setCurrentUserProfile(null);
      }
    });
    return () => unsub();
  }, []);

  const canRaiseDispute = Boolean(
    isSrAdmin || currentUserProfile?.role === 'Admin Sr.' || currentUserProfile?.role === 'Admin L1'
  );

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await get(ref(rtdb, 'audit_logs'));
      const val = snap.val();
      if (!val) {
        setEvents([]);
      } else {
        const list: AuditEvent[] = Object.keys(val).map(key => ({
          id: key,
          ...val[key],
        }));
        // Sort newest first
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setEvents(list);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('Are you sure you want to permanently delete this audit log entry?')) return;
    setDeletingId(logId);
    try {
      await remove(ref(rtdb, `audit_logs/${logId}`));
      setEvents(prev => prev.filter(e => e.id !== logId));
      setActionMsg('Audit log entry deleted successfully.');
      setTimeout(() => setActionMsg(null), 3000);
    } catch (err) {
      console.error('Failed to delete audit log:', err);
      alert('Error deleting audit log: You must be Admin Sr.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredEvents = useMemo(() => {
    return events.filter(evt => {
      // Role filter
      if (roleFilter !== 'ALL') {
        if (roleFilter === 'Admin Sr.' && !evt.actorRole.includes('Admin Sr.')) return false;
        if (roleFilter === 'Question Setter' && evt.actorRole !== 'Question Setter') return false;
        if (roleFilter === 'Admin L1' && evt.actorRole !== 'Admin L1') return false;
      }

      // Action Category
      if (actionCategory !== 'ALL') {
        if (actionCategory === 'QUESTIONS' && !evt.action.includes('QUESTION')) return false;
        if (actionCategory === 'SECTIONS' && !evt.action.includes('SECTION')) return false;
        if (actionCategory === 'TESTS' && !evt.action.includes('TEST')) return false;
        if (actionCategory === 'PERSONNEL' && !evt.action.includes('PERSONNEL')) return false;
        if (actionCategory === 'SOLUTIONS' && !evt.action.includes('SOLUTIONS')) return false;
        if (actionCategory === 'PARTICIPANTS' && !evt.action.includes('PARTICIPANT')) return false;
      }

      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const actorNameMatch = evt.actorName?.toLowerCase().includes(q);
        const actorEmailMatch = evt.actorEmail?.toLowerCase().includes(q);
        const targetTitleMatch = evt.targetTitle?.toLowerCase().includes(q);
        const actionMatch = evt.actionLabel?.toLowerCase().includes(q);
        const tagMatch = evt.details?.questionTag?.toLowerCase().includes(q);
        const snippetMatch = evt.details?.questionSnippet?.toLowerCase().includes(q);
        const testMatch = evt.details?.testTitle?.toLowerCase().includes(q);
        const secMatch = evt.details?.sectionName?.toLowerCase().includes(q);
        const partEmailMatch =
          evt.details?.participantEmail?.toLowerCase().includes(q) ||
          evt.details?.participantsList?.some(p => p.email.toLowerCase().includes(q));
        const partNameMatch =
          evt.details?.participantName?.toLowerCase().includes(q) ||
          evt.details?.participantsList?.some(p => p.name?.toLowerCase().includes(q));

        if (
          !actorNameMatch &&
          !actorEmailMatch &&
          !targetTitleMatch &&
          !actionMatch &&
          !tagMatch &&
          !snippetMatch &&
          !testMatch &&
          !secMatch &&
          !partEmailMatch &&
          !partNameMatch
        ) {
          return false;
        }
      }

      return true;
    });
  }, [events, roleFilter, actionCategory, search]);

  const stats = useMemo(() => {
    const total = events.length;
    const adminSrCount = events.filter(e => e.actorRole.includes('Admin Sr.')).length;
    const questionSetterCount = events.filter(e => e.actorRole === 'Question Setter').length;
    const questionActions = events.filter(e => e.action.includes('QUESTION')).length;
    const participantActions = events.filter(e => e.action.includes('PARTICIPANT')).length;
    return { total, adminSrCount, questionSetterCount, questionActions, participantActions };
  }, [events]);

  const getActionBadgeClass = (action: string) => {
    if (
      action.startsWith('ADD') ||
      action.startsWith('CREATE') ||
      action.startsWith('APPROVE') ||
      action.startsWith('BULK')
    ) {
      return 'badge badge-green';
    }
    if (action.startsWith('EDIT') || action.startsWith('UPDATE') || action.startsWith('SUBMIT')) {
      return 'badge badge-amber';
    }
    if (
      action.startsWith('DELETE') ||
      action.startsWith('REJECT') ||
      action.startsWith('REVOKE')
    ) {
      return 'badge badge-red';
    }
    return 'badge badge-gray';
  };

  const getRoleBadge = (role: string) => {
    if (role.includes('Admin Sr.')) {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(155, 34, 38, 0.18)',
            color: '#ff6b6b',
            border: '1px solid rgba(155, 34, 38, 0.5)',
            fontSize: '0.6875rem',
            fontWeight: 600,
            borderRadius: '2px',
            padding: '2px 7px',
          }}
        >
          Admin Sr.
        </span>
      );
    }
    if (role === 'Question Setter') {
      return (
        <span
          className="badge badge-green"
          style={{ fontSize: '0.6875rem', fontWeight: 600, borderRadius: '2px', padding: '2px 7px' }}
        >
          Question Setter
        </span>
      );
    }
    if (role === 'Admin L1') {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(33, 150, 243, 0.12)',
            color: '#64b5f6',
            border: '1px solid rgba(33, 150, 243, 0.4)',
            fontSize: '0.6875rem',
            fontWeight: 600,
            borderRadius: '2px',
            padding: '2px 7px',
          }}
        >
          Admin L1
        </span>
      );
    }
    return <span className="badge badge-gray" style={{ borderRadius: '2px', padding: '2px 7px', fontSize: '0.6875rem' }}>{role}</span>;
  };

  const formatTimestamp = (iso: string) => {
    try {
      const date = new Date(iso);
      return {
        formatted: formatDateTime(date, 'ordinal', false, true),
        relative: getRelativeTime(date),
      };
    } catch {
      return { formatted: iso, relative: '' };
    }
  };

  const getRelativeTime = (d: Date) => {
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {actionMsg && (
        <div className="alert alert-success" style={{ animation: 'fadeIn 150ms ease' }}>
          {actionMsg}
        </div>
      )}

      {/* Header & Stats bar */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-secondary) 100%)',
          border: '1px solid var(--border-light)',
        }}
      >
        <div
          className="flex justify-between items-center"
          style={{ marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 'var(--space-md)' }}
        >
          <div>
            <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>
              Activity Audit &amp; Events View
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Detailed chronological log of question setters, supreme administrators (Admin Sr.), candidates, and personnel actions.
            </p>
          </div>
          <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
            <Link
              href="/tcc"
              className="btn btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-light)',
              }}
            >
              <MessageSquareQuote size={15} color="#52b788" />
              <span>Team Coordination Corner (TCC)</span>
            </Link>
            <button
              className="btn btn-outline btn-sm"
              onClick={fetchEvents}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh Logs'}
            </button>
          </div>
        </div>

        {/* Metric Quick Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 'var(--space-sm)',
            marginTop: 'var(--space-sm)',
          }}
        >
          <div
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Events</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--white)' }}>
              {stats.total}
            </div>
          </div>
          <div
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Question Actions</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-green-light)' }}>
              {stats.questionActions}
            </div>
          </div>
          <div
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Setter Activities</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-amber-light)' }}>
              {stats.questionSetterCount}
            </div>
          </div>
          <div
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Participant Events</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#64b5f6' }}>
              {stats.participantActions}
            </div>
          </div>
          <div
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Admin Sr. Logs</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#ff6b6b' }}>
              {stats.adminSrCount}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          padding: 'var(--space-md)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              type="text"
              className="input"
              placeholder="Search by actor name, email, participant, question tag, test, action..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Filter Buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-sm)',
          }}
        >
          {/* Roles */}
          <div className="flex gap-xs" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 6 }}>
              Role:
            </span>
            {['ALL', 'Admin Sr.', 'Question Setter', 'Admin L1'].map(role => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`btn btn-sm ${roleFilter === role ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                {role === 'ALL' ? 'All Roles' : role}
              </button>
            ))}
          </div>

          {/* Categories */}
          <div className="flex gap-xs" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 6 }}>
              Category:
            </span>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'QUESTIONS', label: 'Questions' },
              { id: 'SECTIONS', label: 'Sections' },
              { id: 'TESTS', label: 'Tests' },
              { id: 'PERSONNEL', label: 'Personnel' },
              { id: 'PARTICIPANTS', label: 'Participants' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setActionCategory(cat.id)}
                className={`btn btn-sm ${actionCategory === cat.id ? 'btn-outline' : 'btn-ghost'}`}
                style={{
                  fontSize: '0.75rem',
                  padding: '4px 10px',
                  borderColor: actionCategory === cat.id ? 'var(--white)' : undefined,
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div className="spinner" style={{ margin: '0 auto var(--space-md)' }} />
          <p style={{ color: 'var(--text-muted)' }}>Loading event logs...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
            {events.length === 0
              ? 'No activity events recorded yet.'
              : 'No activity matches your filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {filteredEvents.map(evt => {
            const time = formatTimestamp(evt.timestamp);
            const isExpanded = expandedEventId === evt.id;

            return (
              <div
                key={evt.id}
                className="card"
                style={{
                  padding: 'var(--space-md)',
                  transition: 'background var(--transition-fast)',
                  background: isExpanded ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  borderLeft: evt.actorRole.includes('Admin Sr.')
                    ? '3px solid #ff6b6b'
                    : evt.actorRole === 'Admin L1'
                    ? '3px solid #64b5f6'
                    : '3px solid var(--accent-green-light)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--space-md)',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Left: Actor & Action Info */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
                    <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: 'var(--white)' }}>
                        {evt.actorName || evt.actorEmail}
                      </span>
                      {getRoleBadge(evt.actorRole)}
                      <span className={getActionBadgeClass(evt.action)}>
                        {evt.actionLabel || evt.action}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <strong>{evt.targetTitle}</strong>
                      {evt.details?.testTitle && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                          · in Test: <em>{evt.details.testTitle}</em>
                        </span>
                      )}
                      {evt.details?.sectionName && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                          · Section: <em>{evt.details.sectionName}</em>
                        </span>
                      )}
                    </div>

                    {evt.actorEmail && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {evt.actorEmail}
                      </span>
                    )}
                  </div>

                  {/* Right: Timestamp & Controls */}
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{ fontSize: '0.8125rem', color: '#ffffff', opacity: 0.85 }}>
                      <span title={time.formatted}>{time.relative}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.8125rem',
                        fontFamily: 'var(--font-mono)',
                        color: '#ffffff',
                        fontWeight: 600,
                      }}
                    >
                      {time.formatted}
                    </div>

                    <div className="flex items-center gap-xs" style={{ marginTop: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {canRaiseDispute && (
                        <button
                          className="btn btn-sm"
                          style={{
                            fontSize: '0.75rem',
                            padding: '2px 8px',
                            background: 'rgba(155, 34, 38, 0.22)',
                            color: '#ff6b6b',
                            border: '1px solid rgba(155, 34, 38, 0.55)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          onClick={() => {
                            setDisputeTargetEvent(evt);
                            setDisputeModalOpen(true);
                          }}
                          title="Dispute this log activity"
                        >
                          <ShieldAlert size={12} color="#ff6b6b" />
                          <span>Raise Dispute</span>
                        </button>
                      )}

                      {evt.details && Object.keys(evt.details).length > 0 && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--accent-green-light)' }}
                          onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                        >
                          {isExpanded ? 'Hide Details' : 'View Details'}
                        </button>
                      )}

                      {isSrAdmin && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--accent-red-light)' }}
                          onClick={() => handleDeleteLog(evt.id)}
                          disabled={deletingId === evt.id}
                        >
                          {deletingId === evt.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Collapsible details panel */}
                {isExpanded && evt.details && (
                  <div
                    style={{
                      marginTop: 'var(--space-md)',
                      padding: 'var(--space-md)',
                      background: 'var(--bg-primary)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    {evt.details.participantEmail && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Candidate: </span>
                        <strong>{evt.details.participantName ? `${evt.details.participantName} ` : ''}</strong>
                        <code style={{ color: 'var(--accent-green-light)' }}>
                          &lt;{evt.details.participantEmail}&gt;
                        </code>
                      </div>
                    )}
                    {evt.details.oldEmail && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Previous Email: </span>
                        <code style={{ color: 'var(--text-secondary)' }}>
                          &lt;{evt.details.oldEmail}&gt;
                        </code>
                      </div>
                    )}
                    {evt.details.questionTag && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Question Tag: </span>
                        <code style={{ color: 'var(--accent-amber-light)' }}>
                          #{evt.details.questionTag}
                        </code>
                      </div>
                    )}
                    {evt.details.questionSnippet && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Question Text: </span>
                        <blockquote
                          style={{
                            margin: '4px 0 0 0',
                            padding: '6px 12px',
                            background: 'var(--bg-secondary)',
                            borderLeft: '2px solid var(--border-focus)',
                            color: 'var(--text-secondary)',
                            fontStyle: 'italic',
                          }}
                        >
                          &ldquo;{evt.details.questionSnippet}&rdquo;
                        </blockquote>
                      </div>
                    )}
                    {evt.details.targetEmail && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Target Personnel: </span>
                        <span>
                          {evt.details.targetName} ({evt.details.targetEmail})
                        </span>
                      </div>
                    )}
                    {evt.details.targetRole && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Target Role: </span>
                        <span>{evt.details.targetRole}</span>
                      </div>
                    )}
                    {evt.details.count !== undefined && !evt.details.participantsList && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Items Count: </span>
                        <span>{evt.details.count}</span>
                      </div>
                    )}
                    {evt.details.participantsList && evt.details.participantsList.length > 0 && (
                      <ParticipantRosterViewer
                        list={evt.details.participantsList}
                        fileName={evt.details.fileName}
                        duplicateCount={evt.details.duplicateCount}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Raise Dispute Modal */}
      <RaiseDisputeModal
        isOpen={disputeModalOpen}
        onClose={() => {
          setDisputeModalOpen(false);
          setDisputeTargetEvent(null);
        }}
        event={disputeTargetEvent}
        currentUser={currentUserProfile}
        onDisputeCreated={(sessionId) => {
          setActionMsg(`Dispute session opened in Team Coordination Corner. Log initiator has been pinged.`);
          setTimeout(() => setActionMsg(null), 5000);
        }}
      />
    </div>
  );
}
