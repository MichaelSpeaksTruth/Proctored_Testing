'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { rtdb } from '@/lib/firebase';
import { ref, get } from 'firebase/database';
import { AuditEvent } from '@/lib/auditLogger';

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

        if (
          !actorNameMatch &&
          !actorEmailMatch &&
          !targetTitleMatch &&
          !actionMatch &&
          !tagMatch &&
          !snippetMatch &&
          !testMatch &&
          !secMatch
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
    return { total, adminSrCount, questionSetterCount, questionActions };
  }, [events]);

  const getActionBadgeClass = (action: string) => {
    if (action.startsWith('ADD') || action.startsWith('CREATE') || action.startsWith('APPROVE')) {
      return 'badge badge-green';
    }
    if (action.startsWith('EDIT') || action.startsWith('UPDATE') || action.startsWith('SUBMIT')) {
      return 'badge badge-amber';
    }
    if (action.startsWith('DELETE') || action.startsWith('REJECT') || action.startsWith('REVOKE')) {
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
          👑 Admin Sr.
        </span>
      );
    }
    if (role === 'Question Setter') {
      return (
        <span
          className="badge badge-green"
          style={{ fontSize: '0.75rem', fontWeight: 600 }}
        >
          ✏️ Question Setter
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
          🛡️ Admin L1
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
              Activity Audit & Events View
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Detailed chronological log of question setters, supreme administrators (Admin Sr.), and personnel actions.
            </p>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={fetchEvents}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            🔄 {loading ? 'Refreshing...' : 'Refresh Logs'}
          </button>
        </div>

        {/* Metric Quick Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
              placeholder="Search by actor name, email, question tag, test, action..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Filter Pills */}
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
              ? 'No activity events recorded yet. Actions by Question Setters and Admin Sr. will appear here.'
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

                  {/* Right: Timestamp & Details toggle */}
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

                    {evt.details && Object.keys(evt.details).length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--accent-green-light)' }}
                        onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                      >
                        {isExpanded ? 'Hide Details ▲' : 'View Details ▼'}
                      </button>
                    )}
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
