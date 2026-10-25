'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { auth, rtdb } from '@/lib/firebase';
import { ref, get, remove, update } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { AuditEvent } from '@/lib/auditLogger';
import { isAdmin } from '@/lib/adminUtils';

interface EventsAuditViewProps {
  embeddedInAdmin?: boolean;
}

export default function EventsAuditView({ embeddedInAdmin = false }: EventsAuditViewProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [actionCategory, setActionCategory] = useState<string>('ALL');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isSrAdmin, setIsSrAdmin] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Flag Participant Modal state
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagEmail, setFlagEmail] = useState('');
  const [flagName, setFlagName] = useState('');
  const [flagAction, setFlagAction] = useState<'flag' | 'unflag'>('flag');
  const [flagCategory, setFlagCategory] = useState('Integrity Flag');
  const [flagReason, setFlagReason] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setIsSrAdmin(isAdmin(u?.email));
    });
    return () => unsub();
  }, []);

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

  const handleClearFiltered = async () => {
    const count = filteredEvents.length;
    if (!confirm(`Are you sure you want to permanently delete ${count} audit log entries?`)) return;
    setLoading(true);
    try {
      const updates: Record<string, null> = {};
      filteredEvents.forEach(e => {
        updates[`audit_logs/${e.id}`] = null;
      });
      await update(ref(rtdb), updates);
      setActionMsg(`Successfully deleted ${count} audit log entries.`);
      setTimeout(() => setActionMsg(null), 3000);
      await fetchEvents();
    } catch (err) {
      console.error('Failed to bulk delete audit logs:', err);
      alert('Error deleting logs');
    } finally {
      setLoading(false);
    }
  };

  const openFlagModal = (opts?: {
    email?: string;
    name?: string;
    action?: 'flag' | 'unflag';
    category?: string;
    reason?: string;
  }) => {
    setFlagEmail(opts?.email || '');
    setFlagName(opts?.name || '');
    setFlagAction(opts?.action || 'flag');
    setFlagCategory(opts?.category || 'Integrity Flag');
    setFlagReason(opts?.reason || '');
    setFlagError(null);
    setFlagModalOpen(true);
  };

  const handleFlagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flagEmail.trim()) {
      setFlagError('Participant email is required.');
      return;
    }
    setFlagSubmitting(true);
    setFlagError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setFlagError('Authentication required. Please sign in again.');
        setFlagSubmitting(false);
        return;
      }
      const res = await fetch('/api/flag-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          email: flagEmail.trim().toLowerCase(),
          name: flagName.trim(),
          action: flagAction,
          category: flagCategory,
          reason: flagReason,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFlagError(data.error || 'Failed to update participant flag.');
        setFlagSubmitting(false);
        return;
      }

      setActionMsg(
        flagAction === 'unflag'
          ? `Successfully removed flag for ${flagEmail}.`
          : `Successfully flagged participant ${flagEmail} (${flagCategory}).`
      );
      setTimeout(() => setActionMsg(null), 4000);
      setFlagModalOpen(false);
      await fetchEvents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error occurred.';
      setFlagError(message);
    } finally {
      setFlagSubmitting(false);
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
        const partEmailMatch = evt.details?.participantEmail?.toLowerCase().includes(q);
        const partNameMatch = evt.details?.participantName?.toLowerCase().includes(q);
        const flagReasonMatch = evt.details?.flagReason?.toLowerCase().includes(q);

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
          !partNameMatch &&
          !flagReasonMatch
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
      action.startsWith('REVOKE') ||
      action.startsWith('FLAG')
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
            background: 'rgba(155, 34, 38, 0.25)',
            color: '#ff6b6b',
            border: '1px solid rgba(155, 34, 38, 0.6)',
            fontSize: '0.75rem',
            fontWeight: 600,
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
          style={{ fontSize: '0.75rem', fontWeight: 600 }}
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
            background: 'rgba(33, 150, 243, 0.2)',
            color: '#64b5f6',
            border: '1px solid rgba(33, 150, 243, 0.5)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          Admin L1
        </span>
      );
    }
    return <span className="badge badge-gray">{role}</span>;
  };

  const formatTimestamp = (iso: string) => {
    try {
      const date = new Date(iso);
      return {
        formatted: date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
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
            <button
              className="btn btn-outline btn-sm"
              onClick={() => openFlagModal()}
              style={{ borderColor: 'rgba(255, 107, 107, 0.4)', color: '#ff6b6b' }}
            >
              Flag Participant
            </button>
            {isSrAdmin && filteredEvents.length > 0 && (
              <button
                className="btn btn-outline btn-sm"
                style={{ color: 'var(--accent-red-light)', borderColor: 'rgba(155, 34, 38, 0.5)' }}
                onClick={handleClearFiltered}
                disabled={loading}
              >
                Delete {filteredEvents.length === events.length ? 'All Logs' : `Filtered Logs (${filteredEvents.length})`}
              </button>
            )}
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
            const hasParticipant =
              Boolean(evt.details?.participantEmail) || evt.action.includes('PARTICIPANT');
            const participantEmail =
              evt.details?.participantEmail ||
              (evt.action.includes('PARTICIPANT') && evt.targetTitle?.includes('@')
                ? evt.targetTitle.trim()
                : '');

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
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      <span title={time.formatted}>{time.relative}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-dim)',
                      }}
                    >
                      {time.formatted}
                    </div>

                    <div className="flex items-center gap-xs" style={{ marginTop: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {/* In-log flag control */}
                      {evt.action === 'FLAG_PARTICIPANT' ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--accent-amber-light)' }}
                          onClick={() =>
                            openFlagModal({
                              email: evt.details?.participantEmail || participantEmail,
                              name: evt.details?.participantName,
                              action: 'unflag',
                              category: evt.details?.flagCategory,
                              reason: evt.details?.flagReason,
                            })
                          }
                          title="Remove flag from this candidate"
                        >
                          Remove Flag
                        </button>
                      ) : hasParticipant && participantEmail ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px', color: '#ff6b6b' }}
                          onClick={() =>
                            openFlagModal({
                              email: participantEmail,
                              name: evt.details?.participantName,
                              action: 'flag',
                            })
                          }
                          title="Flag this candidate"
                        >
                          Flag Candidate
                        </button>
                      ) : null}

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
                    {evt.details.flagCategory && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Flag Category: </span>
                        <span className="badge badge-red" style={{ fontSize: '0.75rem' }}>
                          {evt.details.flagCategory}
                        </span>
                      </div>
                    )}
                    {evt.details.flagReason && (
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Flag Reason: </span>
                        <blockquote
                          style={{
                            margin: '4px 0 0 0',
                            padding: '6px 12px',
                            background: 'var(--bg-secondary)',
                            borderLeft: '2px solid #ff6b6b',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {evt.details.flagReason}
                        </blockquote>
                      </div>
                    )}
                    {evt.details.flaggedBy && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Flagged By: </span>
                        <span>{evt.details.flaggedBy}</span>
                      </div>
                    )}
                    {evt.details.unflaggedBy && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Unflagged By: </span>
                        <span>{evt.details.unflaggedBy}</span>
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
                    {evt.details.count !== undefined && (
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Items Count: </span>
                        <span>{evt.details.count}</span>
                      </div>
                    )}

                    {/* Quick in-log action inside details */}
                    {participantEmail && (
                      <div style={{ marginTop: 'var(--space-sm)', paddingTop: 'var(--space-xs)', borderTop: '1px solid var(--border)' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px', borderColor: 'rgba(255, 107, 107, 0.4)', color: '#ff6b6b' }}
                          onClick={() =>
                            openFlagModal({
                              email: participantEmail,
                              name: evt.details?.participantName,
                              action: evt.action === 'FLAG_PARTICIPANT' ? 'unflag' : 'flag',
                            })
                          }
                        >
                          {evt.action === 'FLAG_PARTICIPANT' ? 'Unflag Candidate in Database' : 'Flag Candidate in Database'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Flag / Unflag Participant Modal */}
      {flagModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--space-md)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => {
            if (!flagSubmitting) setFlagModalOpen(false);
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 520,
              width: '100%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-light)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>
                {flagAction === 'unflag' ? 'Remove Participant Flag' : 'Flag Participant'}
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFlagModalOpen(false)}
                disabled={flagSubmitting}
                style={{ padding: '2px 8px' }}
              >
                Close
              </button>
            </div>

            {flagError && (
              <div className="alert alert-danger" style={{ marginBottom: 'var(--space-md)' }}>
                {flagError}
              </div>
            )}

            <form onSubmit={handleFlagSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Participant Email *
                </label>
                <input
                  type="email"
                  required
                  className="input"
                  placeholder="candidate@example.com"
                  value={flagEmail}
                  onChange={e => setFlagEmail(e.target.value)}
                  disabled={flagSubmitting}
                  style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Candidate Name (Optional)
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Full name"
                  value={flagName}
                  onChange={e => setFlagName(e.target.value)}
                  disabled={flagSubmitting}
                  style={{ width: '100%' }}
                />
              </div>

              {flagAction === 'flag' ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Flag Category *
                    </label>
                    <select
                      className="input"
                      value={flagCategory}
                      onChange={e => setFlagCategory(e.target.value)}
                      disabled={flagSubmitting}
                      style={{ width: '100%' }}
                    >
                      <option value="Integrity Flag">Integrity Flag</option>
                      <option value="Proctoring Anomaly">Proctoring Anomaly</option>
                      <option value="Unfair Means / Cheating">Unfair Means / Cheating</option>
                      <option value="Multiple Faces Detected">Multiple Faces Detected</option>
                      <option value="Absence from Camera">Absence from Camera</option>
                      <option value="Tab Switching Violation">Tab Switching Violation</option>
                      <option value="Identity Verification Issue">Identity Verification Issue</option>
                      <option value="Disciplinary Review">Disciplinary Review</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Audit Notes / Reason *
                    </label>
                    <textarea
                      className="input"
                      rows={3}
                      required
                      placeholder="Describe reason for flagging this participant..."
                      value={flagReason}
                      onChange={e => setFlagReason(e.target.value)}
                      disabled={flagSubmitting}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>
                </>
              ) : (
                <div style={{ padding: 'var(--space-md)', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)' }}>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    This will remove the integrity flag from participant <strong>{flagEmail}</strong> and unflag any associated examination results.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-sm" style={{ marginTop: 'var(--space-sm)' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFlagModalOpen(false)}
                  disabled={flagSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn btn-sm ${flagAction === 'unflag' ? 'btn-outline' : 'btn-primary'}`}
                  style={flagAction === 'flag' ? { background: '#9b2226', borderColor: '#9b2226' } : {}}
                  disabled={flagSubmitting}
                >
                  {flagSubmitting
                    ? 'Processing...'
                    : flagAction === 'unflag'
                    ? 'Remove Flag'
                    : 'Confirm and Flag'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
