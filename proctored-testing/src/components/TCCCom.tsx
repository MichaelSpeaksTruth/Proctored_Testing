'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  TCCSession,
  TCCUserSessionSummary,
  TCCMessage,
  TCCNotification,
  ApprovedPersonnelInfo,
  getPersonnelProfile,
  getApprovedPersonnelList,
  createStandardSession,
  sendTCCMessage,
  resolveTCCDispute,
  markSessionAsRead,
  subscribeUserSessions,
  subscribeSession,
  subscribeUserNotifications,
  clearUserNotifications,
} from '@/lib/tccService';
import {
  MessageSquare,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle2,
  Users,
  Send,
  Bell,
  Clock,
  Shield,
  ShieldAlert,
  ArrowLeft,
  X,
  FileText,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';

interface TCCComProps {
  initialSessionId?: string | null;
  onBackToDashboard?: () => void;
}

export default function TCCCom({ initialSessionId, onBackToDashboard }: TCCComProps) {
  // Current user & personnel profile
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [personnelProfile, setPersonnelProfile] = useState<ApprovedPersonnelInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Sessions state (up to 50 for the user)
  const [sessions, setSessions] = useState<TCCUserSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId || null);
  const [activeSession, setActiveSession] = useState<TCCSession | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'dispute' | 'standard' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Messages state
  const [messageInput, setMessageInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New session modal
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionInitialMsg, setNewSessionInitialMsg] = useState('');
  const [allPersonnel, setAllPersonnel] = useState<ApprovedPersonnelInfo[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<ApprovedPersonnelInfo[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Resolve dispute modal
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<TCCNotification[]>([]);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  // Details drawer
  const [showParticipantsDrawer, setShowParticipantsDrawer] = useState(false);

  // 1. Auth & Profile Detection
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setCurrentUser(u);
      if (u) {
        const prof = await getPersonnelProfile(u);
        setPersonnelProfile(prof);
      } else {
        setPersonnelProfile(null);
      }
      setAuthChecking(false);
    });
    return () => unsub();
  }, []);

  // 2. Subscribe to user's conversation sessions (max 50 past sessions)
  useEffect(() => {
    if (!personnelProfile) {
      setSessions([]);
      return;
    }
    const unsub = subscribeUserSessions(personnelProfile.encodedEmail, (userSessions) => {
      setSessions(userSessions);
      // Auto-select initial or first session if activeSessionId is not set
      if (!activeSessionId && userSessions.length > 0) {
        setActiveSessionId(userSessions[0].sessionId);
      }
    });
    return () => unsub();
  }, [personnelProfile, activeSessionId]);

  // 3. React if initialSessionId changes from URL
  useEffect(() => {
    if (initialSessionId) {
      setActiveSessionId(initialSessionId);
    }
  }, [initialSessionId]);

  // 4. Subscribe to active session details
  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      return;
    }

    if (personnelProfile) {
      markSessionAsRead(personnelProfile.encodedEmail, activeSessionId);
    }

    const unsub = subscribeSession(activeSessionId, (sess) => {
      setActiveSession(sess);
    });
    return () => unsub();
  }, [activeSessionId, personnelProfile]);

  // 5. Subscribe to notifications / pings
  useEffect(() => {
    if (!personnelProfile) {
      setNotifications([]);
      return;
    }
    const unsub = subscribeUserNotifications(personnelProfile.encodedEmail, (notifs) => {
      setNotifications(notifs);
    });
    return () => unsub();
  }, [personnelProfile]);

  // Scroll to bottom of message list on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  // Load all approved personnel when opening new conversation modal
  useEffect(() => {
    if (newSessionModalOpen) {
      setNewSessionTitle('');
      setNewSessionInitialMsg('');
      setCreateError(null);
      getApprovedPersonnelList().then((list) => {
        // Exclude current user from selectable list
        const others = list.filter((p) => p.email.toLowerCase() !== personnelProfile?.email.toLowerCase());
        setAllPersonnel(others);
        setSelectedPersonnel(others); // Preselect all for easy collaboration
      });
    }
  }, [newSessionModalOpen, personnelProfile]);

  // Filtered session list
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filterType === 'dispute' && s.type !== 'dispute') return false;
      if (filterType === 'standard' && s.type !== 'standard') return false;
      if (filterType === 'mine' && s.createdByEmail !== personnelProfile?.email) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = s.title?.toLowerCase().includes(q);
        const snippetMatch = s.lastMessageSnippet?.toLowerCase().includes(q);
        const emailMatch = s.createdByEmail?.toLowerCase().includes(q);
        if (!titleMatch && !snippetMatch && !emailMatch) return false;
      }
      return true;
    });
  }, [sessions, filterType, searchQuery, personnelProfile]);

  // Convert messages object to sorted array
  const messagesList = useMemo(() => {
    if (!activeSession?.messages) return [];
    const list: TCCMessage[] = Object.values(activeSession.messages);
    list.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
    return list;
  }, [activeSession?.messages]);

  // Actions
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageInput.trim() || !activeSessionId || !personnelProfile || sendingMsg) return;

    setSendingMsg(true);
    try {
      await sendTCCMessage({
        sessionId: activeSessionId,
        sender: personnelProfile,
        text: messageInput.trim(),
      });
      setMessageInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSendingMsg(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionTitle.trim() || !personnelProfile) {
      setCreateError('Please enter a session title / subject.');
      return;
    }

    setCreatingSession(true);
    setCreateError(null);
    try {
      const sessionId = await createStandardSession({
        title: newSessionTitle.trim(),
        initialMessage: newSessionInitialMsg.trim(),
        creator: personnelProfile,
        invitedParticipants: selectedPersonnel,
      });

      setNewSessionModalOpen(false);
      setActiveSessionId(sessionId);
    } catch (err: any) {
      console.error('Failed to create session:', err);
      setCreateError(err?.message || 'Failed to initiate conversation session.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleResolveDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSessionId || !personnelProfile || !resolutionNotes.trim()) return;

    setResolving(true);
    try {
      await resolveTCCDispute({
        sessionId: activeSessionId,
        resolver: personnelProfile,
        notes: resolutionNotes.trim(),
      });
      setResolveModalOpen(false);
      setResolutionNotes('');
    } catch (err) {
      console.error('Failed to resolve dispute:', err);
    } finally {
      setResolving(false);
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    if (role.includes('Admin Sr.')) {
      return {
        background: 'rgba(155, 34, 38, 0.22)',
        color: '#ff6b6b',
        border: '1px solid rgba(155, 34, 38, 0.55)',
      };
    }
    if (role === 'Admin L1') {
      return {
        background: 'rgba(33, 150, 243, 0.15)',
        color: '#64b5f6',
        border: '1px solid rgba(33, 150, 243, 0.45)',
      };
    }
    if (role === 'Question Setter') {
      return {
        background: 'rgba(45, 106, 79, 0.22)',
        color: '#52b788',
        border: '1px solid rgba(45, 106, 79, 0.55)',
      };
    }
    return {
      background: 'rgba(255, 255, 255, 0.1)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border)',
    };
  };

  if (authChecking) {
    return (
      <div className="loading-center" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ marginBottom: 12 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Verifying TCC personnel credentials...</p>
      </div>
    );
  }

  if (!personnelProfile) {
    return (
      <div className="card" style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center', padding: 'var(--space-2xl) var(--space-xl)' }}>
        <ShieldAlert size={48} color="#ff6b6b" style={{ margin: '0 auto var(--space-md)' }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: 8, color: 'var(--white)' }}>
          Access Restricted: TCC Personnel Only
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)' }}>
          The Team Coordination Corner (TCC) is strictly accessible to verified <strong>Admin Sr.</strong>, <strong>Admin L1</strong>, and <strong>Question Setter</strong> personnel.
        </p>
        <Link href="/" className="btn btn-primary">
          Return to Platform Home
        </Link>
      </div>
    );
  }

  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const canResolveActiveDispute =
    activeSession?.type === 'dispute' &&
    activeSession?.status !== 'resolved' &&
    (personnelProfile.role === 'Admin Sr.' ||
      activeSession.disputeDetails?.raisedByEmail.toLowerCase() === personnelProfile.email.toLowerCase());

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 80px)',
        minHeight: 640,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-md">
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px 8px' }}
              title="Back to dashboard"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="flex items-center gap-xs">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-xs)',
                background: 'linear-gradient(135deg, rgba(45, 106, 79, 0.4), rgba(155, 34, 38, 0.4))',
                border: '1px solid var(--border-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--white)',
              }}
            >
              <MessageSquare size={16} />
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--white)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Team Coordination Corner</span>
                <span className="badge" style={{ fontSize: '0.625rem', padding: '1px 5px', background: 'rgba(255,255,255,0.08)' }}>
                  TCC COM
                </span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                Admin Sr. &middot; Admin L1 &middot; Question Setter Unified Room
              </div>
            </div>
          </div>
        </div>

        {/* User Identity & Notification Controls */}
        <div className="flex items-center gap-md">
          <div className="flex items-center gap-xs" style={{ fontSize: '0.8125rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Logged as:</span>
            <span style={{ fontWeight: 600, color: 'var(--white)' }}>{personnelProfile.name}</span>
            <span
              className="badge"
              style={{ ...getRoleBadgeStyle(personnelProfile.role), fontSize: '0.6875rem', padding: '2px 7px' }}
            >
              {personnelProfile.role}
            </span>
          </div>

          {/* Notifications Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
              style={{
                position: 'relative',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                background: notifDropdownOpen ? 'var(--bg-primary)' : 'transparent',
              }}
              title="Dispute pings & notifications"
            >
              <Bell size={16} color={unreadNotifCount > 0 ? '#ff6b6b' : 'var(--text-secondary)'} />
              {unreadNotifCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    background: '#ff6b6b',
                    color: '#fff',
                    borderRadius: '10px',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    lineHeight: '1.1',
                  }}
                >
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* Notifications Popover */}
            {notifDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 6,
                  width: 340,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 9999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-primary)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--white)' }}>
                    Pings &amp; Alert Notifications
                  </span>
                  {notifications.length > 0 && (
                    <button
                      onClick={() => clearUserNotifications(personnelProfile.encodedEmail)}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.6875rem', padding: '2px 6px', color: 'var(--text-muted)' }}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      No active pings or notifications.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          setActiveSessionId(notif.sessionId);
                          setNotifDropdownOpen(false);
                        }}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: notif.type === 'dispute_ping' ? 'rgba(155, 34, 38, 0.08)' : 'transparent',
                          transition: 'background var(--transition-fast)',
                        }}
                      >
                        <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              color: notif.type === 'dispute_ping' ? '#ff6b6b' : 'var(--accent-green-light)',
                            }}
                          >
                            {notif.type === 'dispute_ping' ? '⚠️ DISPUTE PING' : 'SESSION INVITE'}
                          </span>
                          <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                            {formatTime(notif.timestamp)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--white)', marginBottom: 2 }}>
                          {notif.title}
                        </div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                          {notif.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Split Layout: Left Sessions Sidebar (Max 50) | Right Chat Pane */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar: Past 50 Conversation Sessions */}
        <aside
          style={{
            width: 330,
            background: 'var(--bg-primary)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* New Session Button & Search */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setNewSessionModalOpen(true)}
              className="btn btn-primary"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: '0.8125rem',
                padding: '8px 12px',
                marginBottom: 10,
              }}
            >
              <Plus size={16} />
              <span>Initiate Conversation Session</span>
            </button>

            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                className="input"
                placeholder="Search past sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', paddingLeft: 30, fontSize: '0.75rem', height: 32 }}
              />
            </div>

            {/* Filter Tabs */}
            <div
              style={{
                display: 'flex',
                gap: 4,
                marginTop: 8,
                padding: 2,
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              {[
                { id: 'all', label: 'All' },
                { id: 'dispute', label: 'Disputes' },
                { id: 'standard', label: 'General' },
                { id: 'mine', label: 'Mine' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterType(tab.id as any)}
                  className={`btn btn-sm ${filterType === tab.id ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    flex: 1,
                    fontSize: '0.6875rem',
                    padding: '3px 2px',
                    borderRadius: 'var(--radius-xs)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sessions List Header info */}
          <div
            style={{
              padding: '6px 14px',
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            <span>Sessions History (Past 50 Limit)</span>
            <span>{filteredSessions.length} total</span>
          </div>

          {/* Sessions Scroll List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredSessions.length === 0 ? (
              <div style={{ padding: 'var(--space-xl) var(--space-md)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                {sessions.length === 0
                  ? 'No conversation sessions yet. Click "Initiate Conversation Session" above to start one!'
                  : 'No sessions match your filter.'}
              </div>
            ) : (
              filteredSessions.map((s) => {
                const isSelected = activeSessionId === s.sessionId;
                return (
                  <div
                    key={s.sessionId}
                    onClick={() => setActiveSessionId(s.sessionId)}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: isSelected
                        ? 'var(--bg-card-hover)'
                        : s.unread
                        ? 'rgba(45, 106, 79, 0.08)'
                        : 'transparent',
                      borderLeft: isSelected
                        ? s.type === 'dispute'
                          ? '3px solid #ff6b6b'
                          : '3px solid var(--accent-green-light)'
                        : '3px solid transparent',
                      transition: 'background var(--transition-fast)',
                    }}
                  >
                    <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                      <div className="flex items-center gap-xs" style={{ minWidth: 0, flex: 1 }}>
                        {s.type === 'dispute' ? (
                          <span
                            className="badge"
                            style={{
                              background: 'rgba(155, 34, 38, 0.25)',
                              color: '#ff6b6b',
                              fontSize: '0.625rem',
                              padding: '1px 5px',
                              border: '1px solid rgba(155, 34, 38, 0.5)',
                            }}
                          >
                            DISPUTE
                          </span>
                        ) : (
                          <span
                            className="badge badge-gray"
                            style={{ fontSize: '0.625rem', padding: '1px 5px' }}
                          >
                            CHAT
                          </span>
                        )}

                        {s.status === 'resolved' && (
                          <span
                            className="badge badge-green"
                            style={{ fontSize: '0.625rem', padding: '1px 5px' }}
                          >
                            Resolved
                          </span>
                        )}

                        {s.unread && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--accent-green-light)',
                              display: 'inline-block',
                            }}
                          />
                        )}
                      </div>

                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {formatTime(s.lastActivity)}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: s.unread ? 700 : 600,
                        color: 'var(--white)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: 4,
                      }}
                      title={s.title}
                    >
                      {s.title}
                    </div>

                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.lastMessageSnippet || 'No messages yet'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Area: Active Conversation / Chat Window */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {activeSession ? (
            <>
              {/* Session Header */}
              <div
                style={{
                  padding: '12px 18px',
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-md)',
                  flexShrink: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center gap-xs" style={{ marginBottom: 3 }}>
                    <span
                      className="badge"
                      style={{
                        ...(activeSession.type === 'dispute'
                          ? {
                              background: 'rgba(155, 34, 38, 0.25)',
                              color: '#ff6b6b',
                              border: '1px solid rgba(155, 34, 38, 0.5)',
                            }
                          : {
                              background: 'rgba(45, 106, 79, 0.2)',
                              color: '#52b788',
                              border: '1px solid rgba(45, 106, 79, 0.5)',
                            }),
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                      }}
                    >
                      {activeSession.type === 'dispute' ? '⚠️ DISPUTE CASE' : 'DISCUSSION SESSION'}
                    </span>

                    {activeSession.status === 'resolved' && (
                      <span className="badge badge-green" style={{ fontSize: '0.6875rem' }}>
                        <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                        Resolved
                      </span>
                    )}

                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                      Started by {activeSession.createdBy.name} ({activeSession.createdBy.role})
                    </span>
                  </div>

                  <h3
                    style={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      margin: 0,
                      color: 'var(--white)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeSession.title}
                  </h3>
                </div>

                {/* Session Actions */}
                <div className="flex items-center gap-sm">
                  {canResolveActiveDispute && (
                    <button
                      onClick={() => setResolveModalOpen(true)}
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(45, 106, 79, 0.3)',
                        color: 'var(--accent-green-light)',
                        border: '1px solid var(--accent-green-light)',
                        fontSize: '0.75rem',
                        padding: '4px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <CheckCircle2 size={14} />
                      <span>Resolve Dispute</span>
                    </button>
                  )}

                  <button
                    onClick={() => setShowParticipantsDrawer(!showParticipantsDrawer)}
                    className="btn btn-outline btn-sm"
                    style={{
                      fontSize: '0.75rem',
                      padding: '4px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Users size={14} />
                    <span>{Object.keys(activeSession.participants || {}).length} Participants</span>
                  </button>
                </div>
              </div>

              {/* Dispute Context Alert Box (if session is dispute) */}
              {activeSession.disputeDetails && (
                <div
                  style={{
                    background: 'rgba(155, 34, 38, 0.1)',
                    borderBottom: '1px solid rgba(155, 34, 38, 0.35)',
                    padding: '10px 18px',
                    fontSize: '0.8125rem',
                    flexShrink: 0,
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                    <div className="flex items-center gap-xs">
                      <ShieldAlert size={15} color="#ff6b6b" />
                      <strong style={{ color: '#ff6b6b' }}>Dispute Details:</strong>
                      <span className="badge badge-gray" style={{ fontSize: '0.6875rem' }}>
                        {activeSession.disputeDetails.logActionLabel || activeSession.disputeDetails.logAction}
                      </span>
                      <span style={{ color: 'var(--white)' }}>
                        Target: <em>{activeSession.disputeDetails.logTargetTitle}</em>
                      </span>
                    </div>

                    <div className="flex items-center gap-xs">
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        Initiator Pinged:
                      </span>
                      <strong style={{ color: 'var(--white)', fontSize: '0.75rem' }}>
                        {activeSession.disputeDetails.logActorName}
                      </strong>
                    </div>
                  </div>

                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: 2 }}>
                    <strong>Grounds: </strong>
                    <span>{activeSession.disputeDetails.disputeReason}</span>
                  </div>

                  {activeSession.disputeDetails.resolved && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: '6px 10px',
                        background: 'rgba(45, 106, 79, 0.15)',
                        border: '1px solid rgba(45, 106, 79, 0.4)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.75rem',
                        color: 'var(--accent-green-light)',
                      }}
                    >
                      <strong>Resolution: </strong>
                      {activeSession.disputeDetails.resolutionNotes} (by {activeSession.disputeDetails.resolvedBy})
                    </div>
                  )}
                </div>
              )}

              {/* Participants Drawer (Collapsible) */}
              {showParticipantsDrawer && (
                <div
                  style={{
                    background: 'var(--bg-primary)',
                    borderBottom: '1px solid var(--border)',
                    padding: '10px 18px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 4 }}>
                    Active Personnel in this Room:
                  </span>
                  {Object.values(activeSession.participants || {}).map((p) => (
                    <div
                      key={p.email}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 8px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.75rem',
                      }}
                    >
                      <span style={{ color: 'var(--white)', fontWeight: 500 }}>{p.name}</span>
                      <span
                        className="badge"
                        style={{ ...getRoleBadgeStyle(p.role), fontSize: '0.625rem', padding: '1px 5px' }}
                      >
                        {p.role}
                      </span>
                      {p.isLogInitiator && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(155, 34, 38, 0.3)',
                            color: '#ff6b6b',
                            fontSize: '0.5625rem',
                            padding: '1px 4px',
                          }}
                        >
                          Log Initiator
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Messages Feed */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {messagesList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-2xl) 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No messages yet in this session. Start the coordination by sending a message below!
                  </div>
                ) : (
                  messagesList.map((msg) => {
                    if (msg.isSystemNotice) {
                      return (
                        <div
                          key={msg.id}
                          style={{
                            alignSelf: 'center',
                            maxWidth: '85%',
                            padding: '8px 14px',
                            background: msg.isDisputeNotice ? 'rgba(155, 34, 38, 0.12)' : 'rgba(45, 106, 79, 0.12)',
                            border: msg.isDisputeNotice
                              ? '1px solid rgba(155, 34, 38, 0.35)'
                              : '1px solid rgba(45, 106, 79, 0.35)',
                            borderRadius: 'var(--radius-sm)',
                            textAlign: 'center',
                            fontSize: '0.75rem',
                            color: msg.isDisputeNotice ? '#ff6b6b' : 'var(--accent-green-light)',
                          }}
                        >
                          {msg.text}
                          <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: 3 }}>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      );
                    }

                    const isMine = msg.senderEmail.toLowerCase() === personnelProfile.email.toLowerCase();

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignSelf: isMine ? 'flex-end' : 'flex-start',
                          maxWidth: '75%',
                        }}
                      >
                        <div
                          className="flex items-center gap-xs"
                          style={{
                            marginBottom: 3,
                            justifyContent: isMine ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--white)' }}>
                            {isMine ? 'You' : msg.senderName}
                          </span>
                          <span
                            className="badge"
                            style={{ ...getRoleBadgeStyle(msg.senderRole), fontSize: '0.625rem', padding: '1px 5px' }}
                          >
                            {msg.senderRole}
                          </span>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>

                        <div
                          style={{
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-md)',
                            background: isMine ? 'rgba(45, 106, 79, 0.28)' : 'var(--bg-card)',
                            border: isMine
                              ? '1px solid rgba(45, 106, 79, 0.6)'
                              : '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            fontSize: '0.875rem',
                            lineHeight: '1.5',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer Area */}
              <div
                style={{
                  padding: '12px 18px',
                  background: 'var(--bg-card)',
                  borderTop: '1px solid var(--border)',
                  flexShrink: 0,
                }}
              >
                {/* Quick Response Chips */}
                <div className="flex gap-xs" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  {[
                    'Under Investigation',
                    'Acknowledged',
                    'Test verified and rectified',
                    'Question updated',
                    'Requesting Sr. Review',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setMessageInput((prev) => (prev ? `${prev} - ${chip}` : chip))}
                      style={{ fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 'var(--radius-xs)' }}
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <textarea
                    className="input"
                    rows={2}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={`Type response as ${personnelProfile.name} (${personnelProfile.role})... [Enter to send]`}
                    style={{ flex: 1, resize: 'none', padding: '8px 12px', fontSize: '0.875rem' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={sendingMsg || !messageInput.trim()}
                    style={{
                      height: 48,
                      padding: '0 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-2xl)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 'var(--space-md)',
                  color: 'var(--text-muted)',
                }}
              >
                <MessageSquare size={32} />
              </div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: 8, color: 'var(--white)' }}>
                Team Coordination Corner (TCC)
              </h3>
              <p style={{ maxWidth: 440, color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)' }}>
                Select an existing session from your past 50 conversation history on the left, or initiate a new coordination session with fellow personnel.
              </p>
              <button
                onClick={() => setNewSessionModalOpen(true)}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Plus size={16} />
                <span>Initiate New Session</span>
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Initiate New Conversation Session */}
      {newSessionModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-md)',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-lg)',
              position: 'relative',
            }}
          >
            <button
              onClick={() => setNewSessionModalOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--white)' }}>
              Initiate TCC Conversation Session
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
              Any approved personnel (Admin Sr., Admin L1, Question Setter) can initiate a coordination session. This will be added to everyone&apos;s past 50 sessions index.
            </p>

            {createError && (
              <div className="alert alert-danger" style={{ marginBottom: 12, padding: '8px 12px', fontSize: '0.8125rem' }}>
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSession} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Session Title / Subject <span style={{ color: '#ff6b6b' }}>*</span>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Physics Section Question #104 Clarification"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              {/* Select Personnel to Invite */}
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                    Involved Personnel ({selectedPersonnel.length} invited)
                  </label>
                  <div className="flex gap-xs">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelectedPersonnel(allPersonnel)}
                      style={{ fontSize: '0.6875rem', padding: '2px 6px' }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSelectedPersonnel([])}
                      style={{ fontSize: '0.6875rem', padding: '2px 6px' }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    background: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border)',
                    padding: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {allPersonnel.length === 0 ? (
                    <div style={{ padding: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      No other approved personnel found.
                    </div>
                  ) : (
                    allPersonnel.map((person) => {
                      const isSelected = selectedPersonnel.some((p) => p.encodedEmail === person.encodedEmail);
                      return (
                        <label
                          key={person.encodedEmail}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '5px 8px',
                            borderRadius: 'var(--radius-xs)',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setSelectedPersonnel((prev) => prev.filter((p) => p.encodedEmail !== person.encodedEmail));
                              } else {
                                setSelectedPersonnel((prev) => [...prev, person]);
                              }
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="flex items-center gap-xs">
                              <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--white)' }}>
                                {person.name}
                              </span>
                              <span
                                className="badge"
                                style={{ ...getRoleBadgeStyle(person.role), fontSize: '0.625rem', padding: '1px 5px' }}
                              >
                                {person.role}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              {person.email}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Initial message */}
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Opening Message / Briefing
                </label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Introduce the purpose of this conversation session..."
                  value={newSessionInitialMsg}
                  onChange={(e) => setNewSessionInitialMsg(e.target.value)}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div className="flex justify-end gap-sm" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setNewSessionModalOpen(false)}
                  disabled={creatingSession}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingSession || !newSessionTitle.trim()}
                >
                  {creatingSession ? 'Creating Session...' : 'Create Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Resolve Dispute */}
      {resolveModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-md)',
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-lg)',
              position: 'relative',
            }}
          >
            <button
              onClick={() => setResolveModalOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--white)' }}>
              Resolve Dispute
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
              Mark this dispute as formally resolved. Please provide the resolution summary for the audit trail.
            </p>

            <form onSubmit={handleResolveDispute} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Resolution Notes <span style={{ color: '#ff6b6b' }}>*</span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Detail the agreed resolution, corrections made, or consensus reached..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div className="flex justify-end gap-sm" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setResolveModalOpen(false)}
                  disabled={resolving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={resolving || !resolutionNotes.trim()}
                  style={{ background: 'var(--accent-green)', borderColor: 'var(--accent-green-light)' }}
                >
                  {resolving ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
