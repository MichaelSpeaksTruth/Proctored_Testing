'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  TCCSession,
  TCCUserSessionSummary,
  TCCMessage,
  TCCMessageReply,
  TCCNotification,
  ApprovedPersonnelInfo,
  getPersonnelProfile,
  getApprovedPersonnelList,
  createStandardSession,
  sendTCCMessage,
  resolveTCCDispute,
  markSessionAsRead,
  addParticipantToSession,
  subscribeUserSessions,
  subscribeSession,
  subscribeUserNotifications,
  clearUserNotifications,
  deleteTCCSession,
} from '@/lib/tccService';
import {
  MessageSquare,
  Plus,
  Search,
  CheckCircle2,
  Users,
  Send,
  Bell,
  Clock,
  ShieldAlert,
  ArrowLeft,
  X,
  UserCheck,
  ChevronRight,
  MessageSquarePlus,
  AtSign,
  Check,
  CheckCheck,
  UserPlus,
  Reply,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import BackButton from '@/components/BackButton';

interface TCCComProps {
  initialSessionId?: string | null;
  embedded?: boolean;
  onBackToDashboard?: () => void;
}

export default function TCCCom({
  initialSessionId,
  embedded = false,
  onBackToDashboard,
}: TCCComProps) {
  // Current user & personnel profile
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [personnelProfile, setPersonnelProfile] = useState<ApprovedPersonnelInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Sessions state (strictly up to 50 for the user)
  const [sessions, setSessions] = useState<TCCUserSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId || null);
  const [activeSession, setActiveSession] = useState<TCCSession | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'dispute' | 'standard' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Mobile navigation state ('sidebar' = show sessions list, 'chat' = show chat room)
  const [mobileView, setMobileView] = useState<'sidebar' | 'chat'>('sidebar');

  // Messages state
  const [messageInput, setMessageInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TCCMessageReply | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mentions / Tagging state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Delete session modal (Admin Sr. ONLY)
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<TCCNotification[]>([]);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  // Details drawer & Add Member
  const [showParticipantsDrawer, setShowParticipantsDrawer] = useState(false);
  const [addMemberDropdownOpen, setAddMemberDropdownOpen] = useState(false);

  // Refs for outside-click dismissals across all TCC popups
  const newSessionModalCardRef = useRef<HTMLDivElement>(null);
  const resolveModalCardRef = useRef<HTMLDivElement>(null);
  const deleteModalCardRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);
  const notifTriggerBtnRef = useRef<HTMLButtonElement>(null);
  const addMemberRef = useRef<HTMLDivElement>(null);
  const addMemberTriggerBtnRef = useRef<HTMLButtonElement>(null);
  const participantsDrawerRef = useRef<HTMLDivElement>(null);
  const participantsBtnRef = useRef<HTMLButtonElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);

  // ── UNIVERSAL OUTSIDE-CLICK & ESCAPE KEY HANDLER FOR ALL TCC POPUPS ────────
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      // 1. Notification Dropdown
      if (
        notifDropdownOpen &&
        notifDropdownRef.current &&
        !notifDropdownRef.current.contains(target) &&
        (!notifTriggerBtnRef.current || !notifTriggerBtnRef.current.contains(target))
      ) {
        setNotifDropdownOpen(false);
      }

      // 2. Add Member / Invite Citizen Dropdown
      if (
        addMemberDropdownOpen &&
        addMemberRef.current &&
        !addMemberRef.current.contains(target) &&
        (!addMemberTriggerBtnRef.current || !addMemberTriggerBtnRef.current.contains(target))
      ) {
        setAddMemberDropdownOpen(false);
      }

      // 3. Participants Drawer
      if (
        showParticipantsDrawer &&
        participantsDrawerRef.current &&
        !participantsDrawerRef.current.contains(target) &&
        (!participantsBtnRef.current || !participantsBtnRef.current.contains(target))
      ) {
        setShowParticipantsDrawer(false);
      }

      // 4. Mention Autocomplete Suggestions
      if (
        mentionQuery !== null &&
        mentionDropdownRef.current &&
        !mentionDropdownRef.current.contains(target) &&
        (!textareaRef.current || !textareaRef.current.contains(target))
      ) {
        setMentionQuery(null);
      }

      // 5. New Session Modal
      if (
        newSessionModalOpen &&
        !creatingSession &&
        newSessionModalCardRef.current &&
        !newSessionModalCardRef.current.contains(target)
      ) {
        setNewSessionModalOpen(false);
      }

      // 6. Resolve Dispute Modal
      if (
        resolveModalOpen &&
        !resolving &&
        resolveModalCardRef.current &&
        !resolveModalCardRef.current.contains(target)
      ) {
        setResolveModalOpen(false);
      }

      // 7. Delete Session Modal (Admin Sr. only)
      if (
        sessionToDelete &&
        !deletingSession &&
        deleteModalCardRef.current &&
        !deleteModalCardRef.current.contains(target)
      ) {
        setSessionToDelete(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sessionToDelete && !deletingSession) {
          setSessionToDelete(null);
          return;
        }
        if (newSessionModalOpen && !creatingSession) {
          setNewSessionModalOpen(false);
          return;
        }
        if (resolveModalOpen && !resolving) {
          setResolveModalOpen(false);
          return;
        }
        if (addMemberDropdownOpen) {
          setAddMemberDropdownOpen(false);
          return;
        }
        if (notifDropdownOpen) {
          setNotifDropdownOpen(false);
          return;
        }
        if (showParticipantsDrawer) {
          setShowParticipantsDrawer(false);
          return;
        }
        if (mentionQuery !== null) {
          setMentionQuery(null);
          return;
        }
        if (replyingTo) {
          setReplyingTo(null);
          return;
        }
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    newSessionModalOpen,
    creatingSession,
    resolveModalOpen,
    resolving,
    sessionToDelete,
    deletingSession,
    notifDropdownOpen,
    addMemberDropdownOpen,
    showParticipantsDrawer,
    mentionQuery,
    replyingTo,
  ]);

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
      // On desktop, auto-select first session if none selected
      if (!activeSessionId && userSessions.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
        setActiveSessionId(userSessions[0].sessionId);
      }
    });
    return () => unsub();
  }, [personnelProfile, activeSessionId]);

  // 3. React if initialSessionId changes from URL
  useEffect(() => {
    if (initialSessionId) {
      setActiveSessionId(initialSessionId);
      setMobileView('chat');
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

  // Load all approved personnel across the platform on mount & profile resolution
  useEffect(() => {
    getApprovedPersonnelList().then((list) => {
      const others = list.filter((p) => p.email.toLowerCase() !== personnelProfile?.email.toLowerCase());
      setAllPersonnel(others);
      if (selectedPersonnel.length === 0) {
        setSelectedPersonnel(others);
      }
    });
  }, [personnelProfile]);

  // Reset modal state on open
  useEffect(() => {
    if (newSessionModalOpen) {
      setNewSessionTitle('');
      setNewSessionInitialMsg('');
      setCreateError(null);
    }
  }, [newSessionModalOpen]);

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
  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMobileView('chat');
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageInput.trim() || !activeSessionId || !personnelProfile || sendingMsg) return;

    const currentReply = replyingTo;
    setSendingMsg(true);
    try {
      await sendTCCMessage({
        sessionId: activeSessionId,
        sender: personnelProfile,
        text: messageInput.trim(),
        allPersonnel,
        replyTo: currentReply || undefined,
      });
      setMessageInput('');
      setMentionQuery(null);
      setReplyingTo(null);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSendingMsg(false);
    }
  };

  const handleAddParticipant = async (person: ApprovedPersonnelInfo) => {
    if (!activeSessionId || !personnelProfile) return;
    try {
      await addParticipantToSession({
        sessionId: activeSessionId,
        person,
        addedBy: personnelProfile,
      });
      setAddMemberDropdownOpen(false);
    } catch (err) {
      console.error('Failed to add participant:', err);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!sessionToDelete || !personnelProfile || personnelProfile.role !== 'Admin Sr.') return;
    setDeletingSession(true);
    try {
      const deletedId = sessionToDelete.id;
      await deleteTCCSession({
        sessionId: deletedId,
        adminProfile: personnelProfile,
      });
      if (activeSessionId === deletedId) {
        setActiveSessionId(null);
        if (mobileView === 'chat') {
          setMobileView('sidebar');
        }
      }
      setSessionToDelete(null);
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setDeletingSession(false);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionTitle.trim() || !personnelProfile) {
      setCreateError('Please enter a conversation topic or title.');
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
      setMobileView('chat');
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

  const getInitials = (name?: string) => {
    if (!name) return 'P';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getRoleBadgeStyle = (role: string) => {
    if (role.includes('Admin Sr.')) {
      return {
        background: 'rgba(155, 34, 38, 0.22)',
        color: '#ff6b6b',
        border: '1px solid rgba(155, 34, 38, 0.55)',
        avatarBg: 'linear-gradient(135deg, #780000 0%, #c1121f 100%)',
      };
    }
    if (role === 'Admin L1') {
      return {
        background: 'rgba(33, 150, 243, 0.15)',
        color: '#64b5f6',
        border: '1px solid rgba(33, 150, 243, 0.45)',
        avatarBg: 'linear-gradient(135deg, #0d47a1 0%, #1976d2 100%)',
      };
    }
    if (role === 'Question Setter') {
      return {
        background: 'rgba(45, 106, 79, 0.22)',
        color: '#52b788',
        border: '1px solid rgba(45, 106, 79, 0.55)',
        avatarBg: 'linear-gradient(135deg, #1b4332 0%, #2d6a4f 100%)',
      };
    }
    return {
      background: 'rgba(255, 255, 255, 0.1)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border)',
      avatarBg: '#333333',
    };
  };

  // Available mention candidates (roles, in-room members, and outside platform personnel)
  const mentionCandidates = useMemo(() => {
    const list: {
      id: string;
      label: string;
      insertText: string;
      role?: string;
      isSpecial?: boolean;
      avatar?: string;
      email?: string;
      inRoom?: boolean;
      category: 'special' | 'in_room' | 'outside';
    }[] = [
      { id: 'all', label: '@all', insertText: '@all ', role: 'Everyone in Room', isSpecial: true, category: 'special' },
      { id: 'sr', label: '@Admin Sr.', insertText: '@Admin Sr. ', role: 'Admin Sr.', isSpecial: true, category: 'special' },
      { id: 'l1', label: '@Admin L1', insertText: '@Admin L1 ', role: 'Admin L1', isSpecial: true, category: 'special' },
      { id: 'qs', label: '@Question Setter', insertText: '@Question Setter ', role: 'Question Setter', isSpecial: true, category: 'special' },
    ];

    const inRoomEmails = new Set<string>();

    if (activeSession?.participants) {
      Object.values(activeSession.participants).forEach((p) => {
        inRoomEmails.add(p.email.toLowerCase());
        list.push({
          id: p.email,
          label: `@${p.name}`,
          insertText: `@${p.name} `,
          role: p.role,
          avatar: getInitials(p.name),
          email: p.email,
          inRoom: true,
          category: 'in_room',
        });
      });
    }

    // Include other platform personnel not yet in this room
    if (allPersonnel && allPersonnel.length > 0) {
      allPersonnel.forEach((person) => {
        if (!inRoomEmails.has(person.email.toLowerCase())) {
          list.push({
            id: person.email,
            label: `@${person.name}`,
            insertText: `@${person.name} `,
            role: person.role,
            avatar: getInitials(person.name),
            email: person.email,
            inRoom: false,
            category: 'outside',
          });
        }
      });
    }

    if (mentionQuery === null) return list;
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.insertText.toLowerCase().includes(q) ||
        (c.role && c.role.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
    );
  }, [activeSession?.participants, allPersonnel, mentionQuery]);

  // Platform personnel not yet in this room (for + Add Member & outside tagging)
  const outsidePersonnel = useMemo(() => {
    if (!allPersonnel || !activeSession?.participants) return [];
    const inRoomEmails = new Set(Object.values(activeSession.participants).map((p) => p.email.toLowerCase()));
    return allPersonnel.filter((p) => !inRoomEmails.has(p.email.toLowerCase()));
  }, [allPersonnel, activeSession?.participants]);

  const insertMention = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageInput((prev) => (prev ? `${prev} ${tag}` : tag));
      setMentionQuery(null);
      return;
    }

    const cursorPos = textarea.selectionStart || messageInput.length;
    const textBefore = messageInput.slice(0, cursorPos);
    const textAfter = messageInput.slice(cursorPos);

    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex !== -1 && mentionQuery !== null) {
      const newText = textBefore.slice(0, atIndex) + tag + textAfter;
      setMessageInput(newText);
      setMentionQuery(null);
      setTimeout(() => {
        textarea.focus();
        const newPos = atIndex + tag.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 10);
    } else {
      const spacePrefix = textBefore.length > 0 && !textBefore.endsWith(' ') ? ' ' : '';
      const newText = textBefore + spacePrefix + tag + textAfter;
      setMessageInput(newText);
      setMentionQuery(null);
      setTimeout(() => {
        textarea.focus();
        const newPos = cursorPos + spacePrefix.length + tag.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 10);
    }
  };

  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    const cursorPos = e.target.selectionStart || val.length;
    const textBefore = val.slice(0, cursorPos);
    const lastAt = textBefore.lastIndexOf('@');

    if (lastAt !== -1) {
      const queryPart = textBefore.slice(lastAt + 1);
      // Valid query: no newline and length under 25 chars
      if (!queryPart.includes('\n') && queryPart.length <= 25) {
        setMentionQuery(queryPart);
        setMentionSelectedIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  };

  const renderMessageContent = (text: string) => {
    // Regex splits on @all, @everyone, role tags, or @Name / @email
    const regex = /(@all\b|@everyone\b|@Admin\s+Sr\.|@Admin\s+L1|@Question\s+Setter|@[\w.-]+(?:\s+[\w.-]+)?)/gi;
    const parts = text.split(regex);

    const myName = (personnelProfile?.name || '').toLowerCase();
    const myFirstName = myName.includes(' ') ? myName.split(' ')[0] : myName;
    const myEmail = (personnelProfile?.email || '').toLowerCase();
    const myRole = (personnelProfile?.role || '').toLowerCase();

    return parts.map((part, idx) => {
      if (!part) return null;
      if (part.startsWith('@')) {
        const lowerPart = part.toLowerCase();
        const isTaggingMe =
          lowerPart === '@all' ||
          lowerPart === '@everyone' ||
          lowerPart === `@${myName}` ||
          lowerPart === `@${myFirstName}` ||
          lowerPart === `@${myEmail}` ||
          lowerPart === `@${myRole}`;

        return (
          <span
            key={idx}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '0.84rem',
              fontWeight: 700,
              margin: '0 2px',
              background: isTaggingMe ? 'rgba(244, 162, 97, 0.22)' : 'rgba(33, 150, 243, 0.18)',
              color: isTaggingMe ? '#f4a261' : '#64b5f6',
              border: isTaggingMe ? '1px solid rgba(244, 162, 97, 0.45)' : '1px solid rgba(33, 150, 243, 0.35)',
              boxShadow: isTaggingMe ? '0 0 8px rgba(244, 162, 97, 0.2)' : undefined,
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  if (authChecking) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Verifying personnel credentials...
        </p>
      </div>
    );
  }

  if (!personnelProfile) {
    return (
      <div
        className="card"
        style={{
          maxWidth: 520,
          margin: '60px auto',
          textAlign: 'center',
          padding: 'var(--space-2xl) var(--space-xl)',
          border: '1px solid var(--border-light)',
          background: 'var(--bg-card)',
        }}
      >
        <ShieldAlert size={44} color="#ff6b6b" style={{ margin: '0 auto var(--space-md)' }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: 8, color: 'var(--white)' }}>
          Access Restricted: Approved Personnel Only
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)', lineHeight: 1.6 }}>
          Team Coordination Corner (TCC) is strictly accessible to verified <strong>Admin Sr.</strong>,{' '}
          <strong>Admin L1</strong>, and <strong>Question Setter</strong> accounts.
        </p>
        <Link href="/" className="btn btn-primary" style={{ padding: '8px 20px' }}>
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
      className={`tcc-wrapper ${embedded ? 'tcc-wrapper-embedded' : ''}`}
    >
      {/* ── TOP UNIFIED HEADER BAR (Clean, no nested duplicate) ────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          background: 'rgba(10, 13, 24, 0.96)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(16px)',
          flexShrink: 0,
          gap: 10,
        }}
      >
        {/* Left Brand & Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <BackButton
            fallbackUrl={
              personnelProfile?.role === 'Admin Sr.'
                ? '/admin'
                : personnelProfile?.role === 'Admin L1'
                ? '/admin-l1'
                : personnelProfile?.role === 'Question Setter'
                ? '/question-setter'
                : '/'
            }
            onClick={onBackToDashboard}
          />

          {!embedded && (
            <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-xs)', overflow: 'hidden', flexShrink: 0, boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)' }}>
              <Image src="/aerosoc_logo.jpeg" alt="Logo" width={28} height={28} style={{ objectFit: 'cover' }} />
            </div>
          )}

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className="desktop-only"
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 700,
                  color: 'var(--white)',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                }}
              >
                Team Coordination Corner
              </span>
              <span
                className="mobile-only"
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  color: 'var(--white)',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                }}
              >
                TCC OPS
              </span>
              <span className="tcc-pulse-emerald" title="Live Secure Link" />
              <span
                className="badge desktop-only"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.625rem',
                  padding: '2px 6px',
                  fontWeight: 600,
                }}
              >
                COM
              </span>
            </div>
            <div
              className="desktop-only"
              style={{
                fontSize: '0.6875rem',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Admin Sr. &middot; Admin L1 &middot; Question Setter Room
            </div>
          </div>
        </div>

        {/* Center / Right Links & User Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Quick Platform Links (Desktop only) */}
          {!embedded && (
            <div className="desktop-only-flex" style={{ alignItems: 'center', gap: 6 }}>
              <Link
                href="/admin"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--text-secondary)' }}
              >
                Admin Sr.
              </Link>
              <Link
                href="/admin-l1"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--text-secondary)' }}
              >
                Admin L1
              </Link>
              <Link
                href="/question-setter"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--text-secondary)' }}
              >
                Question Setter
              </Link>
              <Link
                href="/admin/logs"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--text-secondary)' }}
              >
                Logs
              </Link>
            </div>
          )}

          {/* User Profile Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: getRoleBadgeStyle(personnelProfile.role).avatarBg,
                color: '#fff',
                fontSize: '0.6875rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 10px ${getRoleBadgeStyle(personnelProfile.role).avatarBg}80`,
              }}
            >
              {getInitials(personnelProfile.name)}
            </div>
            <div className="desktop-only" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--white)' }}>
              {personnelProfile.name}
            </div>
            <span
              className="badge desktop-only"
              style={{
                ...getRoleBadgeStyle(personnelProfile.role),
                fontSize: '0.625rem',
                padding: '2px 6px',
                fontWeight: 700,
              }}
            >
              {personnelProfile.role}
            </span>
          </div>

          {/* Notification / Ping Bell */}
          <div style={{ position: 'relative' }}>
            <button
              ref={notifTriggerBtnRef}
              className="btn btn-ghost btn-sm"
              onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
              style={{
                position: 'relative',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: notifDropdownOpen ? 'var(--bg-primary)' : 'transparent',
              }}
              title="Dispute Alerts & Pings"
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
                  }}
                >
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {notifDropdownOpen && (
              <div
                ref={notifDropdownRef}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 6,
                  width: 'min(340px, 90vw)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 9999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'var(--bg-primary)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--white)' }}>
                    Pings &amp; Alerts
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

                <div className="custom-scrollbar" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      No active pings or alerts.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => {
                          handleSelectSession(notif.sessionId);
                          setNotifDropdownOpen(false);
                        }}
                        style={{
                          padding: '10px 14px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: notif.type === 'dispute_ping' ? 'rgba(155, 34, 38, 0.1)' : 'transparent',
                          transition: 'background 150ms ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              color:
                                notif.type === 'dispute_ping'
                                  ? '#ff6b6b'
                                  : notif.type === 'mention'
                                  ? '#f4a261'
                                  : 'var(--accent-green-light)',
                            }}
                          >
                            {notif.type === 'dispute_ping'
                              ? '⚠️ DISPUTE PING'
                              : notif.type === 'mention'
                              ? '@ TAG MENTION'
                              : 'SESSION INVITE'}
                          </span>
                          <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                            {formatTime(notif.timestamp)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--white)', marginBottom: 2 }}>
                          {notif.title}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
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

      {/* ── RESPONSIVE BODY: SPLIT ON DESKTOP, SWITCH ON MOBILE ─────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* ── LEFT PANE: SESSIONS LIST (MAX 50 SESSIONS) ─────────────────────── */}
        <aside
          className={`tcc-sidebar-pane ${mobileView === 'chat' ? 'mobile-hidden' : ''}`}
        >
          {/* Top Actions: New Session + Search */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setNewSessionModalOpen(true)}
              className="tcc-btn-cyber-new"
            >
              <MessageSquarePlus size={16} />
              <span>+ New Conversation</span>
            </button>

            {/* Inset Search */}
            <div style={{ position: 'relative', marginTop: 10 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'rgba(255, 255, 255, 0.4)',
                }}
              />
              <input
                type="text"
                placeholder="Search sessions or topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 34,
                  paddingRight: searchQuery ? 30 : 12,
                  fontSize: '0.8rem',
                  height: 36,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  color: '#ffffff',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="tcc-filter-capsule">
              {[
                { id: 'all', label: 'All' },
                { id: 'dispute', label: 'Disputes' },
                { id: 'standard', label: 'General' },
                { id: 'mine', label: 'Mine' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterType(tab.id as any)}
                  className={`tcc-filter-pill-btn ${filterType === tab.id ? 'active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sessions List Header Status */}
          <div
            style={{
              padding: '6px 14px',
              fontSize: '0.6875rem',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(255, 255, 255, 0.01)',
              flexShrink: 0,
            }}
          >
            <span>Past 50 Sessions History</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{filteredSessions.length} total</span>
          </div>

          {/* Sessions Scroll List */}
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredSessions.length === 0 ? (
              <div
                style={{
                  padding: '40px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.8125rem',
                }}
              >
                {sessions.length === 0
                  ? 'No conversation sessions yet. Click "Initiate Conversation Session" above to start one!'
                  : 'No sessions match your search or filter.'}
              </div>
            ) : (
              filteredSessions.map((s) => {
                const isSelected = activeSessionId === s.sessionId;
                return (
                  <div
                    key={s.sessionId}
                    onClick={() => handleSelectSession(s.sessionId)}
                    className={`tcc-session-card ${isSelected ? 'selected' : ''} ${s.type === 'dispute' ? 'is-dispute' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        {s.type === 'dispute' ? (
                          <span
                            className="badge"
                            style={{
                              background: 'rgba(239, 68, 68, 0.2)',
                              color: '#ff6b6b',
                              fontSize: '0.625rem',
                              padding: '2px 6px',
                              border: '1px solid rgba(239, 68, 68, 0.45)',
                              fontWeight: 700,
                              letterSpacing: '0.02em',
                            }}
                          >
                            ⚠️ DISPUTE
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              fontSize: '0.625rem',
                              padding: '2px 6px',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              fontWeight: 700,
                            }}
                          >
                            💬 CHAT
                          </span>
                        )}

                        {s.status === 'resolved' && (
                          <span
                            className="badge badge-green"
                            style={{ fontSize: '0.625rem', padding: '1px 5px', fontWeight: 600 }}
                          >
                            Resolved
                          </span>
                        )}

                        {s.unread && (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#10b981',
                              boxShadow: '0 0 8px #10b981',
                              display: 'inline-block',
                            }}
                          />
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: '0.6875rem', color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'var(--font-mono)' }}>
                          {formatTime(s.lastActivity)}
                        </span>
                        {personnelProfile?.role === 'Admin Sr.' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDelete({ id: s.sessionId, title: s.title });
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'rgba(255, 255, 255, 0.3)',
                              cursor: 'pointer',
                              padding: 3,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 4,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.3)')}
                            title="Delete this session entirely (Admin Sr. only)"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '0.84rem',
                        fontWeight: s.unread ? 700 : 600,
                        color: '#ffffff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: 4,
                        letterSpacing: '-0.01em',
                      }}
                      title={s.title.replace(/^\[DISPUTE\]\s*/i, '')}
                    >
                      {s.title.replace(/^\[DISPUTE\]\s*/i, '')}
                    </div>

                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'rgba(255, 255, 255, 0.55)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.4,
                      }}
                    >
                      {s.lastMessageSnippet || 'Conversation initiated'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ── RIGHT PANE: ACTIVE CHAT ROOM ──────────────────────────────────── */}
        <main
          className={`tcc-chat-pane ${mobileView === 'sidebar' ? 'mobile-hidden' : ''}`}
        >
          {activeSession ? (
            <>
              {/* Active Room Header */}
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(10, 13, 24, 0.96)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(16px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  {/* Back button for mobile view */}
                  <button
                    type="button"
                    className="mobile-only back-btn-unified"
                    onClick={() => setMobileView('sidebar')}
                    style={{ padding: '6px 10px', fontSize: '0.75rem', gap: 4 }}
                  >
                    <ArrowLeft size={14} />
                    <span>Sessions</span>
                  </button>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
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
                        <span className="badge badge-green" style={{ fontSize: '0.6875rem', fontWeight: 600 }}>
                          <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                          Resolved
                        </span>
                      )}

                      <span className="desktop-only" style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        Started by {activeSession.createdBy.name} ({activeSession.createdBy.role})
                      </span>
                    </div>

                    <h3
                      style={{
                        fontSize: '0.9375rem',
                        fontWeight: 700,
                        margin: 0,
                        color: 'var(--white)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={activeSession.title.replace(/^\[DISPUTE\]\s*/i, '')}
                    >
                      {activeSession.title.replace(/^\[DISPUTE\]\s*/i, '')}
                    </h3>
                  </div>
                </div>

                {/* Right controls in chat header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {canResolveActiveDispute && (
                    <button
                      onClick={() => setResolveModalOpen(true)}
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(45, 106, 79, 0.25)',
                        color: 'var(--accent-green-light)',
                        border: '1px solid var(--accent-green-light)',
                        fontSize: '0.75rem',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <CheckCircle2 size={13} />
                      <span className="desktop-only">Resolve Dispute</span>
                    </button>
                  )}

                  {/* Delete Session (Admin Sr. ONLY) */}
                  {personnelProfile?.role === 'Admin Sr.' && (
                    <button
                      type="button"
                      onClick={() => setSessionToDelete({ id: activeSession.id, title: activeSession.title })}
                      className="btn btn-sm"
                      style={{
                        background: 'rgba(155, 34, 38, 0.2)',
                        color: '#ff6b6b',
                        border: '1px solid rgba(155, 34, 38, 0.45)',
                        fontSize: '0.75rem',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        whiteSpace: 'nowrap',
                      }}
                      title="Permanently delete this session and its messages (Admin Sr. only)"
                    >
                      <Trash2 size={13} color="#ff6b6b" />
                      <span className="desktop-only">Delete</span>
                    </button>
                  )}

                  <button
                    ref={participantsBtnRef}
                    onClick={() => setShowParticipantsDrawer(!showParticipantsDrawer)}
                    className="btn btn-outline btn-sm"
                    style={{
                      fontSize: '0.75rem',
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Users size={14} />
                    <span>{Object.keys(activeSession.participants || {}).length}</span>
                  </button>
                </div>
              </div>

              {/* Dispute Alert Context Banner (Clean & Compact) */}
              {activeSession.disputeDetails && (
                <div
                  style={{
                    background: 'rgba(155, 34, 38, 0.08)',
                    borderBottom: '1px solid rgba(155, 34, 38, 0.25)',
                    padding: '6px 16px',
                    fontSize: '0.78125rem',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      <ShieldAlert size={14} color="#ff6b6b" style={{ flexShrink: 0 }} />
                      <span style={{ color: '#ff6b6b', fontWeight: 600 }}>Grounds:</span>
                      <span style={{ color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {activeSession.disputeDetails.disputeReason}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.71875rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span>Target: <strong style={{ color: 'var(--white)' }}>{activeSession.disputeDetails.logActorName}</strong></span>
                      {activeSession.disputeDetails.resolved && (
                        <span className="badge badge-green" style={{ fontSize: '0.625rem', padding: '1px 6px' }}>Resolved</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Participants Drawer (Collapsible & Interactive with Add Member) */}
              {showParticipantsDrawer && (
                <div
                  ref={participantsDrawerRef}
                  className="custom-scrollbar"
                  style={{
                    background: 'var(--bg-primary)',
                    borderBottom: '1px solid var(--border)',
                    padding: '10px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    flexShrink: 0,
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={14} color="var(--accent-green-light)" />
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--white)' }}>
                        Room Personnel ({Object.keys(activeSession.participants || {}).length}):
                      </span>
                    </div>

                    {outsidePersonnel.length > 0 && (
                      <button
                        ref={addMemberTriggerBtnRef}
                        type="button"
                        onClick={() => setAddMemberDropdownOpen(!addMemberDropdownOpen)}
                        className="btn btn-ghost btn-sm"
                        style={{
                          fontSize: '0.6875rem',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(34, 197, 94, 0.4)',
                          color: '#22c55e',
                          background: 'rgba(34, 197, 94, 0.08)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                        }}
                      >
                        <UserPlus size={12} />
                        <span>+ Add Personnel</span>
                      </button>
                    )}
                  </div>

                  {/* Add Personnel Dropdown Panel */}
                  {addMemberDropdownOpen && outsidePersonnel.length > 0 && (
                    <div
                      ref={addMemberRef}
                      style={{
                        padding: '8px 10px',
                        background: '#0a0d10',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        maxHeight: 140,
                        overflowY: 'auto',
                      }}
                      className="custom-scrollbar"
                    >
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                        Click to invite and grant full message history:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {outsidePersonnel.map((person) => (
                          <button
                            key={person.email}
                            type="button"
                            onClick={() => handleAddParticipant(person)}
                            className="btn btn-ghost btn-sm"
                            style={{
                              fontSize: '0.71875rem',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              background: 'rgba(255, 255, 255, 0.03)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span style={{ color: '#ffffff', fontWeight: 600 }}>{person.name}</span>
                            <span className="badge" style={{ ...getRoleBadgeStyle(person.role), fontSize: '0.5625rem', padding: '1px 4px' }}>
                              {person.role}
                            </span>
                            <span style={{ color: '#22c55e', fontSize: '0.6875rem', fontWeight: 700 }}>+ Add</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* In-room members list with Real-Time Read & Presence Status */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {Object.values(activeSession.participants || {}).map((p) => {
                      const isOnline = Date.now() - (p.lastReadTimestamp || 0) < 120000;
                      return (
                        <div
                          key={p.email}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 8px',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: '0.75rem',
                          }}
                        >
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: getRoleBadgeStyle(p.role).avatarBg,
                              color: '#fff',
                              fontSize: '0.5625rem',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                            }}
                          >
                            {getInitials(p.name)}
                            {isOnline && (
                              <span
                                style={{
                                  position: 'absolute',
                                  bottom: -1,
                                  right: -1,
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: '#22c55e',
                                  boxShadow: '0 0 0 1px #000',
                                }}
                              />
                            )}
                          </div>

                          <span style={{ color: 'var(--white)', fontWeight: 500 }}>{p.name}</span>

                          <span
                            className="badge"
                            style={{ ...getRoleBadgeStyle(p.role), fontSize: '0.625rem', padding: '1px 5px' }}
                          >
                            {p.role}
                          </span>

                          {/* Real-time Presence & Read Status */}
                          {isOnline ? (
                            <span style={{ fontSize: '0.625rem', color: '#22c55e', fontWeight: 600 }}>
                              Active now
                            </span>
                          ) : p.lastSeen ? (
                            <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }} title={`Last seen: ${p.lastSeen}`}>
                              Seen {formatTime(p.lastSeen)}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                              Unseen
                            </span>
                          )}

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
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Messages Feed */}
              <div
                className="custom-scrollbar"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {messagesList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No messages in this session yet. Type below to coordinate.
                  </div>
                ) : (
                  messagesList.map((msg) => {
                    if (msg.isSystemNotice) {
                      return (
                        <div
                          key={msg.id}
                          style={{
                            alignSelf: 'center',
                            maxWidth: '90%',
                            padding: '8px 14px',
                            background: msg.isDisputeNotice ? 'rgba(155, 34, 38, 0.12)' : 'rgba(45, 106, 79, 0.12)',
                            border: msg.isDisputeNotice
                              ? '1px solid rgba(155, 34, 38, 0.35)'
                              : '1px solid rgba(45, 106, 79, 0.35)',
                            borderRadius: 'var(--radius-sm)',
                            textAlign: 'center',
                            fontSize: '0.75rem',
                            color: msg.isDisputeNotice ? '#ff6b6b' : 'var(--accent-green-light)',
                            lineHeight: 1.4,
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
                    const isUserTagged =
                      !isMine &&
                      (msg.text.toLowerCase().includes('@all') ||
                        msg.text.toLowerCase().includes('@everyone') ||
                        msg.text.toLowerCase().includes(`@${(personnelProfile?.name || '').toLowerCase()}`) ||
                        msg.text.toLowerCase().includes(`@${(personnelProfile?.role || '').toLowerCase()}`) ||
                        (personnelProfile?.name.includes(' ') &&
                          msg.text.toLowerCase().includes(`@${personnelProfile.name.split(' ')[0].toLowerCase()}`)));

                    return (
                      <div
                        key={msg.id}
                        id={`msg-${msg.id}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignSelf: isMine ? 'flex-end' : 'flex-start',
                          maxWidth: 'min(82%, 620px)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 3,
                            justifyContent: isMine ? 'flex-end' : 'flex-start',
                          }}
                        >
                          {!isMine && (
                            <div
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: getRoleBadgeStyle(msg.senderRole).avatarBg,
                                color: '#fff',
                                fontSize: '0.5625rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifySelf: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {getInitials(msg.senderName)}
                            </div>
                          )}
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
                            background: isMine
                              ? 'linear-gradient(135deg, rgba(45, 106, 79, 0.35) 0%, rgba(27, 67, 50, 0.45) 100%)'
                              : isUserTagged
                              ? 'rgba(244, 162, 97, 0.08)'
                              : 'rgba(255, 255, 255, 0.04)',
                            border: isMine
                              ? '1px solid rgba(64, 145, 108, 0.5)'
                              : isUserTagged
                              ? '1px solid rgba(244, 162, 97, 0.4)'
                              : '1px solid var(--border)',
                            borderLeft: isUserTagged ? '3px solid #f4a261' : undefined,
                            color: 'var(--text-primary)',
                            fontSize: '0.875rem',
                            lineHeight: '1.5',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {/* Quoted Reply Reference */}
                          {msg.replyTo && (
                            <div
                              onClick={() => {
                                const target = document.getElementById(`msg-${msg.replyTo?.id}`);
                                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }}
                              style={{
                                padding: '4px 8px',
                                marginBottom: 6,
                                background: 'rgba(0, 0, 0, 0.25)',
                                borderLeft: '3px solid var(--accent-green-light)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                              }}
                              title="Click to view original message"
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-green-light)', fontWeight: 600, fontSize: '0.6875rem', marginBottom: 2 }}>
                                <Reply size={11} />
                                <span>{msg.replyTo.senderName}</span>
                              </div>
                              <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {msg.replyTo.text}
                              </div>
                            </div>
                          )}

                          {renderMessageContent(msg.text)}
                        </div>

                        {/* Message Actions Row: Reply Button + Read Receipts */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: isMine ? 'flex-end' : 'flex-start',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginTop: 4,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo({
                                id: msg.id,
                                senderName: msg.senderName,
                                senderRole: msg.senderRole,
                                text: msg.text,
                              });
                              textareaRef.current?.focus();
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              fontSize: '0.6875rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              padding: '2px 4px',
                              borderRadius: 4,
                              lineHeight: 1,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                            title="Reply to message"
                          >
                            <Reply size={11} />
                            <span>Reply</span>
                          </button>

                          {/* Real-Time Read Receipts */}
                          {isMine && (() => {
                            const readers = Object.values(activeSession.participants || {}).filter(
                              (p) =>
                                p.email.toLowerCase() !== msg.senderEmail.toLowerCase() &&
                                (p.lastReadTimestamp || 0) >= msg.timestampMs
                            );
                            if (readers.length === 0) {
                              return (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    fontSize: '0.6875rem',
                                    color: 'var(--text-muted)',
                                    marginLeft: 4,
                                  }}
                                  title="Delivered to room"
                                >
                                  <Check size={11} />
                                  <span>Sent</span>
                                </span>
                              );
                            }
                            return (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  fontSize: '0.6875rem',
                                  color: '#22c55e',
                                  fontWeight: 600,
                                  marginLeft: 4,
                                }}
                                title={`Read by:\n${readers.map((r) => `• ${r.name} (${r.role})`).join('\n')}`}
                              >
                                <CheckCheck size={13} color="#22c55e" />
                                <span>
                                  Read by {readers.length === 1 ? readers[0].name.split(' ')[0] : `${readers[0].name.split(' ')[0]} +${readers.length - 1}`}
                                </span>
                              </span>
                            );
                          })()}

                          {!isMine && (() => {
                            const readers = Object.values(activeSession.participants || {}).filter(
                              (p) =>
                                p.email.toLowerCase() !== msg.senderEmail.toLowerCase() &&
                                (p.lastReadTimestamp || 0) >= msg.timestampMs
                            );
                            if (readers.length === 0) return null;
                            return (
                              <span
                                style={{
                                  fontSize: '0.625rem',
                                  color: 'var(--text-muted)',
                                  fontFamily: 'var(--font-mono)',
                                  marginLeft: 4,
                                }}
                                title={`Read by:\n${readers.map((r) => `• ${r.name} (${r.role})`).join('\n')}`}
                              >
                                Seen by {readers.length}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer Area */}
              <div
                className="tcc-composer-wrapper"
                style={{
                  position: 'relative',
                }}
              >
                {/* Floating Autocomplete Mention Suggestions Dropdown */}
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <div
                    ref={mentionDropdownRef}
                    className="custom-scrollbar"
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 16,
                      right: 16,
                      marginBottom: 6,
                      maxHeight: 220,
                      overflowY: 'auto',
                      background: '#0d0d10',
                      border: '1px solid rgba(255, 255, 255, 0.16)',
                      borderRadius: '8px',
                      boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.85)',
                      padding: 5,
                      zIndex: 50,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.6875rem',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AtSign size={12} color="#64b5f6" />
                        <span>Mention Member or Role</span>
                      </span>
                      <span style={{ fontSize: '0.625rem', fontFamily: 'var(--font-mono)' }}>Enter / Tab to pick</span>
                    </div>

                    {mentionCandidates.map((c, idx) => {
                      const isSelected = idx === mentionSelectedIndex;
                      return (
                        <div
                          key={c.insertText}
                          onClick={() => insertMention(c.insertText)}
                          onMouseEnter={() => setMentionSelectedIndex(idx)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 10px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(33, 150, 243, 0.18)' : 'rgba(255, 255, 255, 0.02)',
                            border: isSelected ? '1px solid rgba(33, 150, 243, 0.45)' : '1px solid transparent',
                            transition: 'all 100ms ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                            {c.avatar ? (
                              <div
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: getRoleBadgeStyle(c.role || '').avatarBg,
                                  color: '#fff',
                                  fontSize: '0.625rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {c.avatar}
                              </div>
                            ) : (
                              <div
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: 'rgba(244, 162, 97, 0.25)',
                                  color: '#f4a261',
                                  fontSize: '0.6875rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                @
                              </div>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: '0.8125rem',
                                  fontWeight: 600,
                                  color: '#ffffff',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {c.label}
                              </div>
                              {c.email && (
                                <div
                                  style={{
                                    fontSize: '0.6875rem',
                                    color: 'var(--text-muted)',
                                    fontFamily: 'var(--font-mono)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {c.email}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                            {c.category === 'in_room' && (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(34, 197, 94, 0.15)',
                                  color: '#22c55e',
                                  fontSize: '0.5625rem',
                                  padding: '1px 5px',
                                }}
                              >
                                In room
                              </span>
                            )}
                            {c.category === 'outside' && (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(244, 162, 97, 0.18)',
                                  color: '#f4a261',
                                  border: '1px solid rgba(244, 162, 97, 0.4)',
                                  fontSize: '0.5625rem',
                                  padding: '1px 5px',
                                  fontWeight: 600,
                                }}
                              >
                                + Auto-add
                              </span>
                            )}
                            {c.role && (
                              <span
                                className="badge"
                                style={{
                                  ...getRoleBadgeStyle(c.role),
                                  fontSize: '0.625rem',
                                  padding: '2px 6px',
                                }}
                              >
                                {c.role}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick Tagging Toolbar */}
                <div
                  className="no-scrollbar"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 8,
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                    paddingBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.71875rem',
                      color: 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 600,
                      flexShrink: 0,
                      marginRight: 2,
                    }}
                  >
                    <AtSign size={13} color="#64b5f6" />
                    <span>Tag:</span>
                  </span>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => insertMention('@all ')}
                    style={{
                      fontSize: '0.6875rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(244, 162, 97, 0.4)',
                      color: '#f4a261',
                      background: 'rgba(244, 162, 97, 0.1)',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    @all
                  </button>

                  {Object.values(activeSession.participants || {}).map((p) => {
                    if (p.email.toLowerCase() === personnelProfile?.email.toLowerCase()) return null;
                    const shortName = p.name.includes(' ') ? p.name.split(' ')[0] : p.name;
                    return (
                      <button
                        key={p.email}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => insertMention(`@${p.name} `)}
                        style={{
                          fontSize: '0.6875rem',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(33, 150, 243, 0.35)',
                          color: '#64b5f6',
                          background: 'rgba(33, 150, 243, 0.08)',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        @{shortName}
                      </button>
                    );
                  })}

                  {/* Quick tag other platform personnel (Auto-adds on send) */}
                  {outsidePersonnel.slice(0, 4).map((p) => {
                    const shortName = p.name.includes(' ') ? p.name.split(' ')[0] : p.name;
                    return (
                      <button
                        key={p.email}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => insertMention(`@${p.name} `)}
                        style={{
                          fontSize: '0.6875rem',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px dashed rgba(244, 162, 97, 0.45)',
                          color: '#f4a261',
                          background: 'rgba(244, 162, 97, 0.08)',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                        title={`Tag and auto-add ${p.name} (${p.role}) to this conversation`}
                      >
                        + @{shortName}
                      </button>
                    );
                  })}
                </div>

                {/* Horizontal scrollable quick response pills (Desktop only) */}
                <div
                  className="desktop-only-flex no-scrollbar"
                  style={{
                    gap: 6,
                    marginBottom: 8,
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                    paddingBottom: 2,
                  }}
                >
                  {[
                    'Under Review',
                    'Acknowledged',
                    'Question verified and updated',
                    'Test configuration checked',
                    'Requesting Sr. Admin confirmation',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setMessageInput((prev) => (prev ? `${prev} - ${chip}` : chip))}
                      style={{
                        fontSize: '0.6875rem',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--border)',
                        background: 'rgba(255, 255, 255, 0.02)',
                        flexShrink: 0,
                      }}
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                {/* Active Reply Banner */}
                {replyingTo && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      marginBottom: 8,
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderLeft: '3px solid var(--accent-green-light)',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                      <Reply size={13} color="var(--accent-green-light)" style={{ flexShrink: 0 }} />
                      <span style={{ color: 'var(--accent-green-light)', fontWeight: 600, flexShrink: 0 }}>
                        Replying to {replyingTo.senderName}:
                      </span>
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {replyingTo.text}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                      title="Cancel reply"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <textarea
                    ref={textareaRef}
                    className="tcc-composer-input"
                    rows={1}
                    value={messageInput}
                    onChange={handleComposerChange}
                    onKeyDown={(e) => {
                      if (mentionQuery !== null && mentionCandidates.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionSelectedIndex((prev) => (prev + 1) % mentionCandidates.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionSelectedIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                          return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          const candidate = mentionCandidates[mentionSelectedIndex];
                          if (candidate) {
                            insertMention(candidate.insertText);
                            return;
                          }
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setMentionQuery(null);
                          return;
                        }
                      }

                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Type a message or use @ to tag..."
                  />
                  <button
                    type="submit"
                    className="tcc-send-btn"
                    disabled={sendingMsg || !messageInput.trim()}
                    title="Send Message"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Empty State when no session is selected */
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px 20px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'rgba(45, 106, 79, 0.15)',
                  border: '1px solid rgba(45, 106, 79, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 'var(--space-md)',
                  color: 'var(--accent-green-light)',
                }}
              >
                <MessageSquare size={26} />
              </div>
              <h3 style={{ fontSize: '1.15rem', marginBottom: 6, color: 'var(--white)', fontWeight: 700 }}>
                No Conversation Selected
              </h3>
              <p
                style={{
                  maxWidth: 380,
                  color: 'var(--text-muted)',
                  fontSize: '0.8125rem',
                  marginBottom: 18,
                  lineHeight: 1.5,
                }}
              >
                Select a thread from the history list or start a new conversation to coordinate with administrators and setters.
              </p>
              <button
                onClick={() => setNewSessionModalOpen(true)}
                className="btn btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  background: '#15803d',
                  borderColor: '#22c55e',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  borderRadius: '6px',
                }}
              >
                <MessageSquarePlus size={15} />
                <span>Start Conversation</span>
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ── MODAL: START CONVERSATION (ACCESSIBLE & SCROLLABLE) ──────────────── */}
      {newSessionModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
          }}
          onClick={() => {
            if (!creatingSession) {
              setNewSessionModalOpen(false);
            }
          }}
        >
          <div
            ref={newSessionModalCardRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: 'min(90vh, 640px)',
              height: 'auto',
              display: 'flex',
              flexDirection: 'column',
              background: '#0d0f12',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              position: 'relative',
              boxSizing: 'border-box',
              overflow: 'hidden',
              margin: 'auto',
            }}
          >
            <form
              onSubmit={handleCreateSession}
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                maxHeight: 'min(90vh, 640px)',
                margin: 0,
                overflow: 'hidden',
              }}
            >
              {/* Fixed Header */}
              <div
                style={{
                  padding: '16px 20px 14px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexShrink: 0,
                  background: '#11141a',
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: '1.125rem',
                      fontWeight: 700,
                      margin: 0,
                      color: '#ffffff',
                      letterSpacing: '-0.01em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <MessageSquarePlus size={18} style={{ color: '#22c55e' }} />
                    <span>Start Conversation</span>
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>
                    Direct or group coordination with administrators and question setters.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewSessionModalOpen(false)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    width: 30,
                    height: 30,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 120ms ease',
                  }}
                  title="Close"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <div
                className="custom-scrollbar"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {createError && (
                  <div
                    className="alert alert-danger"
                    style={{ padding: '9px 12px', fontSize: '0.78125rem', borderRadius: '6px' }}
                  >
                    {createError}
                  </div>
                )}

                {/* Session Title Input */}
                <div>
                  <label style={{ fontSize: '0.78125rem', fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text-secondary)' }}>
                    Topic / Subject <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Physics Section Question #104 Review"
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    required
                    autoFocus
                    style={{
                      width: '100%',
                      height: 38,
                      padding: '0 12px',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#ffffff',
                      fontSize: '0.84rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Involved Personnel Selection */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: '0.78125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Involved Personnel
                      </label>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          padding: '1px 7px',
                          borderRadius: '10px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-primary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {selectedPersonnel.length} of {allPersonnel.length} invited
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedPersonnel(allPersonnel)}
                        style={{ fontSize: '0.6875rem', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedPersonnel([])}
                        style={{ fontSize: '0.6875rem', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Personnel Card Scroll List */}
                  <div
                    className="custom-scrollbar"
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      background: '#07080a',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      padding: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    {allPersonnel.length === 0 ? (
                      <div style={{ padding: '20px 14px', fontSize: '0.78125rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                        No other approved personnel registered yet.
                      </div>
                    ) : (
                      allPersonnel.map((person) => {
                        const isChecked = selectedPersonnel.some((p) => p.encodedEmail === person.encodedEmail);
                        return (
                          <div
                            key={person.encodedEmail}
                            onClick={() => {
                              if (isChecked) {
                                setSelectedPersonnel((prev) => prev.filter((p) => p.encodedEmail !== person.encodedEmail));
                              } else {
                                setSelectedPersonnel((prev) => [...prev, person]);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: isChecked ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                              border: isChecked ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(255, 255, 255, 0.05)',
                              transition: 'all 100ms ease',
                              boxSizing: 'border-box',
                              width: '100%',
                            }}
                          >
                            {/* Left: Checkbox + Avatar + Name/Email */}
                            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: 10 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                style={{
                                  width: '16px',
                                  minWidth: '16px',
                                  maxWidth: '16px',
                                  height: '16px',
                                  minHeight: '16px',
                                  maxHeight: '16px',
                                  padding: 0,
                                  margin: 0,
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  accentColor: '#22c55e',
                                }}
                              />

                              <div
                                style={{
                                  width: 28,
                                  minWidth: 28,
                                  height: 28,
                                  borderRadius: '6px',
                                  background: getRoleBadgeStyle(person.role).avatarBg,
                                  color: '#ffffff',
                                  fontSize: '0.625rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                {getInitials(person.name)}
                              </div>

                              <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    fontSize: '0.8125rem',
                                    fontWeight: 600,
                                    color: '#ffffff',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {person.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: '0.6875rem',
                                    color: 'var(--text-muted)',
                                    fontFamily: 'var(--font-mono)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {person.email}
                                </div>
                              </div>
                            </div>

                            {/* Right: Role Badge */}
                            <span
                              className="badge"
                              style={{
                                ...getRoleBadgeStyle(person.role),
                                fontSize: '0.625rem',
                                padding: '2px 6px',
                                flexShrink: 0,
                                marginLeft: 8,
                                fontWeight: 600,
                              }}
                            >
                              {person.role}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Opening Message */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <label style={{ fontSize: '0.78125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Opening Note / Briefing
                    </label>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Optional</span>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Provide context or instructions for this thread..."
                    value={newSessionInitialMsg}
                    onChange={(e) => setNewSessionInitialMsg(e.target.value)}
                    style={{
                      width: '100%',
                      resize: 'none',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#ffffff',
                      fontSize: '0.8125rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Fixed Footer: Always Visible Actions */}
              <div
                style={{
                  padding: '12px 20px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  background: '#11141a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: '0.71875rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: '#ffffff', fontWeight: 600 }}>{selectedPersonnel.length}</span> recipient{selectedPersonnel.length === 1 ? '' : 's'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setNewSessionModalOpen(false)}
                    disabled={creatingSession}
                    style={{ padding: '7px 14px', fontSize: '0.8125rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={creatingSession || !newSessionTitle.trim()}
                    style={{
                      background: '#15803d',
                      borderColor: '#22c55e',
                      fontWeight: 600,
                      padding: '7px 18px',
                      fontSize: '0.8125rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      borderRadius: '6px',
                      color: '#ffffff',
                    }}
                  >
                    <Send size={13} />
                    <span>{creatingSession ? 'Starting...' : 'Start Session'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: RESOLVE DISPUTE ────────────────────────────────────────────── */}
      {resolveModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.84)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
          }}
          onClick={() => {
            if (!resolving) {
              setResolveModalOpen(false);
            }
          }}
        >
          <div
            ref={resolveModalCardRef}
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px 24px',
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
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.4 }}>
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
                  style={{ width: '100%', resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
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
                  style={{
                    background: 'linear-gradient(135deg, #2d6a4f 0%, #1b4332 100%)',
                    borderColor: 'var(--accent-green-light)',
                  }}
                >
                  {resolving ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: DELETE SESSION ENTIRELY (ADMIN SR. ONLY) ────────────────── */}
      {sessionToDelete && personnelProfile?.role === 'Admin Sr.' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
          }}
          onClick={() => {
            if (!deletingSession) setSessionToDelete(null);
          }}
        >
          <div
            ref={deleteModalCardRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              background: '#0d0f12',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
              padding: 20,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BackButton onClick={() => setSessionToDelete(null)} />
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.02em' }}>
                  Delete Session
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSessionToDelete(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: 0, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong style={{ color: '#ffffff' }}>"{sessionToDelete.title.replace(/^\[DISPUTE\]\s*/i, '')}"</strong>?
              This session, all its messages, and participant records will be entirely deleted.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSessionToDelete(null)}
                disabled={deletingSession}
                style={{ fontSize: '0.8125rem', padding: '6px 14px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSession}
                disabled={deletingSession}
                className="btn btn-primary btn-sm"
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  padding: '7px 18px',
                  background: '#d90429',
                  borderColor: '#ef233c',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Trash2 size={13} />
                <span>{deletingSession ? 'Deleting...' : 'Delete Session Entirely'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS for Desktop Split View & Mobile View */}
      <style jsx>{`
        @media (min-width: 768px) {
          .tcc-sidebar-pane {
            display: flex !important;
          }
          .tcc-chat-pane {
            display: flex !important;
          }
          .tcc-mobile-back-btn {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
