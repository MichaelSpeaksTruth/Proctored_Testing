import { rtdb } from '@/lib/firebase';
import {
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  off,
  query,
  orderByChild,
  limitToLast,
} from 'firebase/database';
import { isAdmin, encodeEmail, decodeEmail } from '@/lib/adminUtils';
import { User } from 'firebase/auth';
import { logAuditEvent } from '@/lib/auditLogger';

export type TCCRole = 'Admin Sr.' | 'Admin L1' | 'Question Setter';

export interface ApprovedPersonnelInfo {
  email: string;
  name: string;
  role: TCCRole;
  position?: string;
  encodedEmail: string;
}

export interface TCCParticipant {
  email: string;
  name: string;
  role: TCCRole;
  joinedAt: string;
  addedBy?: string;
  isLogInitiator?: boolean;
  isDisputeRaiser?: boolean;
  lastReadTimestamp?: number;
  lastSeen?: string;
}

export interface TCCMessageReply {
  id: string;
  senderName: string;
  senderRole?: string;
  text: string;
}

export interface TCCMessage {
  id: string;
  senderEmail: string;
  senderName: string;
  senderRole: TCCRole | 'System';
  text: string;
  timestamp: string; // ISO
  timestampMs: number;
  isSystemNotice?: boolean;
  isDisputeNotice?: boolean;
  replyTo?: TCCMessageReply;
}

export interface TCCDisputeDetails {
  logId: string;
  logTimestamp: string;
  logAction: string;
  logActionLabel: string;
  logTargetTitle: string;
  logActorEmail: string;
  logActorName: string;
  logActorRole: string;
  disputeReason: string;
  priority: 'normal' | 'high' | 'urgent';
  raisedByEmail: string;
  raisedByName: string;
  raisedByRole: 'Admin Sr.' | 'Admin L1';
  logDetailsSnippet?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

export interface TCCSession {
  id: string;
  title: string;
  type: 'standard' | 'dispute';
  status: 'active' | 'resolved' | 'archived';
  createdAt: string;
  createdTimestamp: number;
  lastActivity: string;
  lastActivityTimestamp: number;
  createdBy: {
    email: string;
    name: string;
    role: TCCRole;
  };
  participants: Record<string, TCCParticipant>; // keys are encodedEmail
  disputeDetails?: TCCDisputeDetails;
  messages?: Record<string, TCCMessage>;
  lastMessage?: {
    text: string;
    senderName: string;
    senderRole: string;
    timestamp: string;
  };
}

export interface TCCUserSessionSummary {
  sessionId: string;
  title: string;
  type: 'standard' | 'dispute';
  status: 'active' | 'resolved' | 'archived';
  lastActivityTimestamp: number;
  lastActivity: string;
  unread?: boolean;
  createdByEmail: string;
  lastMessageSnippet?: string;
  participantCount?: number;
}

export interface TCCNotification {
  id: string;
  sessionId: string;
  sessionTitle: string;
  type: 'dispute_ping' | 'session_invite' | 'message_ping' | 'mention';
  title: string;
  message: string;
  fromEmail: string;
  fromName: string;
  fromRole: TCCRole;
  timestamp: string;
  timestampMs: number;
  read: boolean;
}

const MAX_SESSIONS_PER_PERSONNEL = 50;

/**
 * Fetch all approved personnel who are eligible for TCC:
 * - Admin Sr. (Supreme Admins from env)
 * - Admin L1 (from RTDB `personnel`)
 * - Question Setter (from RTDB `personnel`)
 */
export async function getApprovedPersonnelList(): Promise<ApprovedPersonnelInfo[]> {
  const result: Map<string, ApprovedPersonnelInfo> = new Map();

  // 1. Add Supreme Admins (Admin Sr.)
  const admin1 = process.env.NEXT_PUBLIC_ADMIN_1?.trim();
  if (admin1) {
    const enc1 = encodeEmail(admin1);
    result.set(enc1, {
      email: admin1.toLowerCase(),
      name: 'Admin Sr. (Primary)',
      role: 'Admin Sr.',
      position: 'Supreme Administrator',
      encodedEmail: enc1,
    });
  }
  const admin2 = process.env.NEXT_PUBLIC_ADMIN_2?.trim();
  if (admin2) {
    const enc2 = encodeEmail(admin2);
    result.set(enc2, {
      email: admin2.toLowerCase(),
      name: 'Admin Sr. (Secondary)',
      role: 'Admin Sr.',
      position: 'Supreme Administrator',
      encodedEmail: enc2,
    });
  }

  // 2. Fetch approved personnel from RTDB
  try {
    const snap = await get(ref(rtdb, 'personnel'));
    const val = snap.val();
    if (val) {
      Object.keys(val).forEach((key) => {
        const item = val[key];
        const role = item.role as string;
        // Only include Admin L1 and Question Setter (and Admin Sr. if stored)
        if (role === 'Admin L1' || role === 'Question Setter' || role === 'Admin Sr.') {
          const email = (item.email || decodeEmail(key)).toLowerCase();
          const encoded = encodeEmail(email);
          const existing = result.get(encoded);
          result.set(encoded, {
            email,
            name: item.name || existing?.name || email,
            role: (existing ? 'Admin Sr.' : (role as TCCRole)),
            position: item.position || existing?.position || role,
            encodedEmail: encoded,
          });
        }
      });
    }
  } catch (err) {
    console.error('Failed to get approved personnel:', err);
  }

  return Array.from(result.values());
}

/**
 * Check and resolve current user's TCC profile and eligibility
 */
export async function getPersonnelProfile(user: User | null): Promise<ApprovedPersonnelInfo | null> {
  if (!user || !user.email) return null;
  const email = user.email.trim().toLowerCase();
  const encoded = encodeEmail(email);

  if (isAdmin(email)) {
    return {
      email,
      name: user.displayName || 'Admin Sr.',
      role: 'Admin Sr.',
      position: 'Supreme Administrator',
      encodedEmail: encoded,
    };
  }

  try {
    const snap = await get(ref(rtdb, `personnel/${encoded}`));
    if (snap.exists()) {
      const data = snap.val();
      const role = data.role as string;
      if (role === 'Admin L1' || role === 'Question Setter') {
        return {
          email,
          name: data.name || user.displayName || email,
          role: role as TCCRole,
          position: data.position || role,
          encodedEmail: encoded,
        };
      }
    }
  } catch (err) {
    console.error('Error fetching personnel profile:', err);
  }

  return null;
}

/**
 * Enforce the 50 conversation sessions limit per personnel:
 * "keep only past 50 conversation sessions for each personnel"
 */
export async function pruneUserSessions(encodedEmail: string): Promise<void> {
  try {
    const userSessionsRef = ref(rtdb, `tcc_user_sessions/${encodedEmail}`);
    const snap = await get(userSessionsRef);
    if (!snap.exists()) return;

    const data = snap.val() as Record<string, TCCUserSessionSummary>;
    const keys = Object.keys(data);
    if (keys.length <= MAX_SESSIONS_PER_PERSONNEL) return;

    // Sort ascending by lastActivityTimestamp (oldest first)
    keys.sort((a, b) => {
      const timeA = data[a]?.lastActivityTimestamp || 0;
      const timeB = data[b]?.lastActivityTimestamp || 0;
      return timeA - timeB;
    });

    const excessCount = keys.length - MAX_SESSIONS_PER_PERSONNEL;
    const toRemove = keys.slice(0, excessCount);

    const updates: Record<string, null> = {};
    for (const key of toRemove) {
      updates[`tcc_user_sessions/${encodedEmail}/${key}`] = null;
    }
    await update(ref(rtdb), updates);
  } catch (err) {
    console.error('Failed to prune user sessions:', err);
  }
}

/**
 * Initiate a new conversation session (by any approved personnel)
 */
export async function createStandardSession(params: {
  title: string;
  initialMessage: string;
  creator: ApprovedPersonnelInfo;
  invitedParticipants: ApprovedPersonnelInfo[];
}): Promise<string> {
  const { title, initialMessage, creator, invitedParticipants } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const sessionsRef = ref(rtdb, 'tcc_sessions');
  const newSessionRef = push(sessionsRef);
  const sessionId = newSessionRef.key || `tcc_${nowMs}`;

  // Assemble participants map
  const participantsMap: Record<string, TCCParticipant> = {};
  participantsMap[creator.encodedEmail] = {
    email: creator.email,
    name: creator.name,
    role: creator.role,
    joinedAt: nowIso,
  };

  invitedParticipants.forEach((p) => {
    participantsMap[p.encodedEmail] = {
      email: p.email,
      name: p.name,
      role: p.role,
      joinedAt: nowIso,
    };
  });

  // Initial message
  const initialMsgId = `msg_${nowMs}`;
  const messagesMap: Record<string, TCCMessage> = {};
  if (initialMessage.trim()) {
    messagesMap[initialMsgId] = {
      id: initialMsgId,
      senderEmail: creator.email,
      senderName: creator.name,
      senderRole: creator.role,
      text: initialMessage.trim(),
      timestamp: nowIso,
      timestampMs: nowMs,
    };
  }

  const sessionData: TCCSession = {
    id: sessionId,
    title: title.trim(),
    type: 'standard',
    status: 'active',
    createdAt: nowIso,
    createdTimestamp: nowMs,
    lastActivity: nowIso,
    lastActivityTimestamp: nowMs,
    createdBy: {
      email: creator.email,
      name: creator.name,
      role: creator.role,
    },
    participants: participantsMap,
    messages: messagesMap,
    lastMessage: initialMessage.trim()
      ? {
          text: initialMessage.trim(),
          senderName: creator.name,
          senderRole: creator.role,
          timestamp: nowIso,
        }
      : undefined,
  };

  await set(newSessionRef, sessionData);

  // Index for every participant and prune to past 50
  const updates: Record<string, any> = {};
  const participantEncKeys = Object.keys(participantsMap);

  for (const encKey of participantEncKeys) {
    updates[`tcc_user_sessions/${encKey}/${sessionId}`] = {
      sessionId,
      title: title.trim(),
      type: 'standard',
      status: 'active',
      lastActivityTimestamp: nowMs,
      lastActivity: nowIso,
      unread: encKey !== creator.encodedEmail,
      createdByEmail: creator.email,
      lastMessageSnippet: initialMessage.trim() || 'Conversation session initiated',
      participantCount: participantEncKeys.length,
    };

    // If not creator, send notification
    if (encKey !== creator.encodedEmail) {
      const notifRef = push(ref(rtdb, `tcc_notifications/${encKey}`));
      updates[`tcc_notifications/${encKey}/${notifRef.key}`] = {
        id: notifRef.key,
        sessionId,
        sessionTitle: title.trim(),
        type: 'session_invite',
        title: `Invited to: ${title.trim()}`,
        message: `${creator.name} (${creator.role}) started a new conversation session with you.`,
        fromEmail: creator.email,
        fromName: creator.name,
        fromRole: creator.role,
        timestamp: nowIso,
        timestampMs: nowMs,
        read: false,
      };
    }
  }

  await update(ref(rtdb), updates);

  // Prune sessions for all participants to maintain 50-limit
  for (const encKey of participantEncKeys) {
    pruneUserSessions(encKey).catch((e) => console.error(e));
  }

  return sessionId;
}

/**
 * Raise a dispute directly from an audit log (Authority: Admin Sr. & Admin L1):
 * - Creates a dispute session
 * - Sets log initiator as involved by default & pings them directly
 * - Dispute raiser can select other parties to be involved
 * - Retains within 50 past sessions per personnel
 */
export async function raiseDisputeFromLog(params: {
  raiser: ApprovedPersonnelInfo; // Admin Sr. or Admin L1
  disputeReason: string;
  priority: 'normal' | 'high' | 'urgent';
  logItem: {
    id: string;
    timestamp: string;
    actorEmail: string;
    actorName: string;
    actorRole: string;
    action: string;
    actionLabel: string;
    targetTitle: string;
    detailsSnippet?: string;
  };
  additionalSelectedParticipants: ApprovedPersonnelInfo[];
}): Promise<string> {
  const { raiser, disputeReason, priority, logItem, additionalSelectedParticipants } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const sessionsRef = ref(rtdb, 'tcc_sessions');
  const newSessionRef = push(sessionsRef);
  const sessionId = newSessionRef.key || `dispute_${nowMs}`;

  const initiatorEmail = (logItem.actorEmail || '').trim().toLowerCase();
  const initiatorEncoded = encodeEmail(initiatorEmail);

  // Build participants: Raiser + Log Initiator (by default) + Additional Selected
  const participantsMap: Record<string, TCCParticipant> = {};

  // 1. Dispute Raiser (Default)
  participantsMap[raiser.encodedEmail] = {
    email: raiser.email,
    name: raiser.name,
    role: raiser.role,
    joinedAt: nowIso,
    isDisputeRaiser: true,
  };

  // 2. Log Initiator (Default)
  participantsMap[initiatorEncoded] = {
    email: initiatorEmail,
    name: logItem.actorName || initiatorEmail,
    role: (logItem.actorRole as TCCRole) || 'Question Setter',
    joinedAt: nowIso,
    isLogInitiator: true,
  };

  // 3. Additional selected parties
  additionalSelectedParticipants.forEach((p) => {
    participantsMap[p.encodedEmail] = {
      email: p.email,
      name: p.name,
      role: p.role,
      joinedAt: nowIso,
    };
  });

  const sessionTitle = `${logItem.actionLabel || logItem.action}: ${logItem.targetTitle}`;

  // Initial System Notice + Opening Dispute Statement
  const noticeMsgId = `msg_notice_${nowMs}`;
  const raiserMsgId = `msg_detail_${nowMs + 1}`;
  const messagesMap: Record<string, TCCMessage> = {
    [noticeMsgId]: {
      id: noticeMsgId,
      senderEmail: 'system@aerosoc',
      senderName: 'System',
      senderRole: 'System',
      text: `Dispute opened by ${raiser.name} · ${logItem.actorName} auto-pinged`,
      timestamp: nowIso,
      timestampMs: nowMs,
      isSystemNotice: true,
      isDisputeNotice: true,
    },
    [raiserMsgId]: {
      id: raiserMsgId,
      senderEmail: raiser.email,
      senderName: raiser.name,
      senderRole: raiser.role,
      text: disputeReason.trim(),
      timestamp: new Date(nowMs + 1).toISOString(),
      timestampMs: nowMs + 1,
    },
  };

  const disputeDetails: TCCDisputeDetails = {
    logId: logItem.id,
    logTimestamp: logItem.timestamp,
    logAction: logItem.action,
    logActionLabel: logItem.actionLabel,
    logTargetTitle: logItem.targetTitle,
    logActorEmail: initiatorEmail,
    logActorName: logItem.actorName,
    logActorRole: logItem.actorRole,
    disputeReason: disputeReason.trim(),
    priority,
    raisedByEmail: raiser.email,
    raisedByName: raiser.name,
    raisedByRole: raiser.role as 'Admin Sr.' | 'Admin L1',
    logDetailsSnippet: logItem.detailsSnippet,
    resolved: false,
  };

  const sessionData: TCCSession = {
    id: sessionId,
    title: sessionTitle,
    type: 'dispute',
    status: 'active',
    createdAt: nowIso,
    createdTimestamp: nowMs,
    lastActivity: nowIso,
    lastActivityTimestamp: nowMs,
    createdBy: {
      email: raiser.email,
      name: raiser.name,
      role: raiser.role,
    },
    participants: participantsMap,
    disputeDetails,
    messages: messagesMap,
    lastMessage: {
      text: `Dispute Reason: ${disputeReason.trim()}`,
      senderName: raiser.name,
      senderRole: raiser.role,
      timestamp: nowIso,
    },
  };

  await set(newSessionRef, sessionData);

  // Update indexes in tcc_user_sessions and dispatch pings
  const updates: Record<string, any> = {};
  const participantEncKeys = Object.keys(participantsMap);

  for (const encKey of participantEncKeys) {
    updates[`tcc_user_sessions/${encKey}/${sessionId}`] = {
      sessionId,
      title: sessionTitle,
      type: 'dispute',
      status: 'active',
      lastActivityTimestamp: nowMs,
      lastActivity: nowIso,
      unread: encKey !== raiser.encodedEmail,
      createdByEmail: raiser.email,
      lastMessageSnippet: `Dispute raised on ${logItem.targetTitle}`,
      participantCount: participantEncKeys.length,
    };

    // Ping notification
    if (encKey !== raiser.encodedEmail) {
      const isInitiator = encKey === initiatorEncoded;
      const notifRef = push(ref(rtdb, `tcc_notifications/${encKey}`));
      updates[`tcc_notifications/${encKey}/${notifRef.key}`] = {
        id: notifRef.key,
        sessionId,
        sessionTitle,
        type: 'dispute_ping',
        title: isInitiator ? `Dispute on Log: ${logItem.targetTitle}` : `Dispute Session: ${logItem.targetTitle}`,
        message: `${raiser.name} pinged you regarding "${logItem.actionLabel || logItem.action}".`,
        fromEmail: raiser.email,
        fromName: raiser.name,
        fromRole: raiser.role,
        timestamp: nowIso,
        timestampMs: nowMs,
        read: false,
      };
    }
  }

  await update(ref(rtdb), updates);

  // Prune past 50 sessions for every participant
  for (const encKey of participantEncKeys) {
    pruneUserSessions(encKey).catch((e) => console.error(e));
  }

  return sessionId;
}

/**
 * Send a message into a session.
 * Automatically detects mentions of ANY platform personnel:
 * If an outside approved personnel is tagged, they are immediately added to the
 * session, receive full message history, and get an instant mention notification.
 */
export async function sendTCCMessage(params: {
  sessionId: string;
  sender: ApprovedPersonnelInfo;
  text: string;
  allPersonnel?: ApprovedPersonnelInfo[];
  replyTo?: TCCMessageReply;
}): Promise<string> {
  const { sessionId, sender, text, allPersonnel, replyTo } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const msgRef = push(ref(rtdb, `tcc_sessions/${sessionId}/messages`));
  const msgId = msgRef.key || `msg_${nowMs}`;

  const message: TCCMessage = {
    id: msgId,
    senderEmail: sender.email,
    senderName: sender.name,
    senderRole: sender.role,
    text: text.trim(),
    timestamp: nowIso,
    timestampMs: nowMs,
    ...(replyTo ? { replyTo } : {}),
  };

  // Fetch session to update participants' user_sessions index
  const sessionSnap = await get(ref(rtdb, `tcc_sessions/${sessionId}`));
  if (!sessionSnap.exists()) {
    throw new Error('Session not found');
  }

  const session = sessionSnap.val() as TCCSession;
  const participants = { ...(session.participants || {}) };

  const updates: Record<string, any> = {};
  updates[`tcc_sessions/${sessionId}/messages/${msgId}`] = message;
  updates[`tcc_sessions/${sessionId}/lastActivity`] = nowIso;
  updates[`tcc_sessions/${sessionId}/lastActivityTimestamp`] = nowMs;
  updates[`tcc_sessions/${sessionId}/lastMessage`] = {
    text: text.trim(),
    senderName: sender.name,
    senderRole: sender.role,
    timestamp: nowIso,
  };

  // Sender has read this message immediately
  updates[`tcc_sessions/${sessionId}/participants/${sender.encodedEmail}/lastReadTimestamp`] = nowMs;
  updates[`tcc_sessions/${sessionId}/participants/${sender.encodedEmail}/lastSeen`] = nowIso;

  const lowerText = text.toLowerCase();
  const isMentionAll = lowerText.includes('@all') || lowerText.includes('@everyone');

  // 1. Check if any OUTSIDE personnel from allPersonnel were mentioned
  const newlyAddedPersonnel: ApprovedPersonnelInfo[] = [];
  if (allPersonnel && allPersonnel.length > 0) {
    for (const person of allPersonnel) {
      if (person.email.toLowerCase() === sender.email.toLowerCase()) continue;
      if (participants[person.encodedEmail]) continue; // already in room

      const nameLower = person.name.toLowerCase();
      const emailLower = person.email.toLowerCase();
      const firstNameLower = person.name.includes(' ') ? person.name.split(' ')[0].toLowerCase() : '';

      const isMentioned =
        lowerText.includes(`@${nameLower}`) ||
        lowerText.includes(`@${emailLower}`) ||
        (firstNameLower.length >= 3 && lowerText.includes(`@${firstNameLower}`));

      if (isMentioned) {
        newlyAddedPersonnel.push(person);
        // Add to local participants map so they also receive index update below
        participants[person.encodedEmail] = {
          email: person.email,
          name: person.name,
          role: person.role,
          joinedAt: nowIso,
          addedBy: `${sender.name} (${sender.role})`,
        };

        // Write participant record into session
        updates[`tcc_sessions/${sessionId}/participants/${person.encodedEmail}`] = {
          email: person.email,
          name: person.name,
          role: person.role,
          joinedAt: nowIso,
          addedBy: `${sender.name} (${sender.role})`,
        };

        // System notice in session timeline
        const noticeRef = push(ref(rtdb, `tcc_sessions/${sessionId}/messages`));
        updates[`tcc_sessions/${sessionId}/messages/${noticeRef.key}`] = {
          id: noticeRef.key,
          senderEmail: 'system',
          senderName: 'TCC System',
          senderRole: 'System',
          text: `👋 ${person.name} (${person.role}) was tagged by ${sender.name} and added to the conversation.`,
          timestamp: nowIso,
          timestampMs: nowMs + 1,
          isSystemNotice: true,
        };
      }
    }
  }

  // 2. Update user_sessions index and dispatch notifications to all participants
  const participantKeys = Object.keys(participants);

  for (const encKey of participantKeys) {
    updates[`tcc_user_sessions/${encKey}/${sessionId}/lastActivityTimestamp`] = nowMs;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/lastActivity`] = nowIso;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/lastMessageSnippet`] = text.trim();
    updates[`tcc_user_sessions/${encKey}/${sessionId}/title`] = session.title;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/type`] = session.type;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/status`] = session.status;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/createdByEmail`] = session.createdBy?.email || sender.email;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/createdAt`] = session.createdAt || nowIso;

    if (encKey !== sender.encodedEmail) {
      updates[`tcc_user_sessions/${encKey}/${sessionId}/unread`] = true;

      const p = participants[encKey];
      if (p) {
        const isTagged =
          isMentionAll ||
          lowerText.includes(`@${p.name.toLowerCase()}`) ||
          lowerText.includes(`@${p.email.toLowerCase()}`) ||
          lowerText.includes(`@${p.role.toLowerCase()}`) ||
          (p.name.includes(' ') && lowerText.includes(`@${p.name.split(' ')[0].toLowerCase()}`));

        if (isTagged) {
          const notifRef = push(ref(rtdb, `tcc_notifications/${encKey}`));
          const isNewlyAdded = newlyAddedPersonnel.some((np) => np.encodedEmail === encKey);
          updates[`tcc_notifications/${encKey}/${notifRef.key}`] = {
            id: notifRef.key,
            sessionId,
            sessionTitle: session.title,
            type: 'mention',
            title: isNewlyAdded ? `@Mention & Added to Room by ${sender.name}` : `@Mention from ${sender.name}`,
            message: isNewlyAdded
              ? `${sender.name} (${sender.role}) tagged you and added you to "${session.title}". You now have full conversation access.`
              : `${sender.name} (${sender.role}) tagged you in "${session.title}": "${text.trim().slice(0, 90)}"`,
            fromEmail: sender.email,
            fromName: sender.name,
            fromRole: sender.role,
            timestamp: nowIso,
            timestampMs: nowMs,
            read: false,
          };
        }
      }
    }
  }

  await update(ref(rtdb), updates);

  // Prune session history to max 50 for newly added personnel
  for (const newP of newlyAddedPersonnel) {
    pruneUserSessions(newP.encodedEmail).catch((err) => console.warn('Prune error for new participant:', err));
  }

  return msgId;
}

/**
 * Manually add an approved platform personnel to an active session
 */
export async function addParticipantToSession(params: {
  sessionId: string;
  person: ApprovedPersonnelInfo;
  addedBy: { name: string; role: string; email: string };
  reason?: string;
}): Promise<void> {
  const { sessionId, person, addedBy, reason } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const sessionSnap = await get(ref(rtdb, `tcc_sessions/${sessionId}`));
  if (!sessionSnap.exists()) throw new Error('Session not found');
  const session = sessionSnap.val() as TCCSession;

  if (session.participants && session.participants[person.encodedEmail]) {
    return; // Already participant
  }

  const updates: Record<string, any> = {};

  // Add to session participants
  updates[`tcc_sessions/${sessionId}/participants/${person.encodedEmail}`] = {
    email: person.email,
    name: person.name,
    role: person.role,
    joinedAt: nowIso,
    addedBy: `${addedBy.name} (${addedBy.role})`,
  };

  // Add to target user's session index
  updates[`tcc_user_sessions/${person.encodedEmail}/${sessionId}`] = {
    sessionId,
    title: session.title,
    type: session.type,
    status: session.status,
    createdAt: session.createdAt,
    createdByEmail: session.createdBy?.email || addedBy.email,
    lastActivity: nowIso,
    lastActivityTimestamp: nowMs,
    lastMessageSnippet: session.lastMessage?.text || 'Added to conversation',
    unread: true,
  };

  // System notice in session timeline
  const noticeRef = push(ref(rtdb, `tcc_sessions/${sessionId}/messages`));
  updates[`tcc_sessions/${sessionId}/messages/${noticeRef.key}`] = {
    id: noticeRef.key,
    senderEmail: 'system',
    senderName: 'TCC System',
    senderRole: 'System',
    text: `👤 ${person.name} (${person.role}) was added to the room by ${addedBy.name}.${reason ? ` (${reason})` : ''}`,
    timestamp: nowIso,
    timestampMs: nowMs,
    isSystemNotice: true,
  };

  // Dispatch notification
  const notifRef = push(ref(rtdb, `tcc_notifications/${person.encodedEmail}`));
  updates[`tcc_notifications/${person.encodedEmail}/${notifRef.key}`] = {
    id: notifRef.key,
    sessionId,
    sessionTitle: session.title,
    type: 'session_invite',
    title: `Added to ${session.title}`,
    message: `${addedBy.name} (${addedBy.role}) added you to "${session.title}". You now have full conversation access.`,
    fromEmail: addedBy.email,
    fromName: addedBy.name,
    fromRole: addedBy.role as TCCRole,
    timestamp: nowIso,
    timestampMs: nowMs,
    read: false,
  };

  await update(ref(rtdb), updates);
  await pruneUserSessions(person.encodedEmail);
}

/**
 * Toggle an emoji reaction on a message
 */
export async function toggleMessageReaction(params: {
  sessionId: string;
  messageId: string;
  emoji: string;
  user: ApprovedPersonnelInfo;
}): Promise<void> {
  const { sessionId, messageId, emoji, user } = params;
  const path = `tcc_sessions/${sessionId}/messages/${messageId}/reactions/${emoji}/${user.encodedEmail}`;
  const snap = await get(ref(rtdb, path));
  if (snap.exists()) {
    await remove(ref(rtdb, path));
  } else {
    await set(ref(rtdb, path), {
      name: user.name,
      role: user.role,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Mark a dispute as resolved (Admin Sr. or Dispute Raiser)
 */
export async function resolveTCCDispute(params: {
  sessionId: string;
  resolver: ApprovedPersonnelInfo;
  notes: string;
}): Promise<void> {
  const { sessionId, resolver, notes } = params;
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const sessionSnap = await get(ref(rtdb, `tcc_sessions/${sessionId}`));
  if (!sessionSnap.exists()) return;
  const session = sessionSnap.val() as TCCSession;

  const noticeMsgId = `msg_resolve_${nowMs}`;
  const noticeMsg: TCCMessage = {
    id: noticeMsgId,
    senderEmail: resolver.email,
    senderName: resolver.name,
    senderRole: resolver.role,
    text: `✅ DISPUTE RESOLVED by ${resolver.name} (${resolver.role}). Resolution Notes: ${notes.trim()}`,
    timestamp: nowIso,
    timestampMs: nowMs,
    isSystemNotice: true,
  };

  const updates: Record<string, any> = {};
  updates[`tcc_sessions/${sessionId}/status`] = 'resolved';
  updates[`tcc_sessions/${sessionId}/disputeDetails/resolved`] = true;
  updates[`tcc_sessions/${sessionId}/disputeDetails/resolvedBy`] = `${resolver.name} (${resolver.role})`;
  updates[`tcc_sessions/${sessionId}/disputeDetails/resolvedAt`] = nowIso;
  updates[`tcc_sessions/${sessionId}/disputeDetails/resolutionNotes`] = notes.trim();
  updates[`tcc_sessions/${sessionId}/messages/${noticeMsgId}`] = noticeMsg;
  updates[`tcc_sessions/${sessionId}/lastActivity`] = nowIso;
  updates[`tcc_sessions/${sessionId}/lastActivityTimestamp`] = nowMs;

  const participantKeys = Object.keys(session.participants || {});
  for (const encKey of participantKeys) {
    updates[`tcc_user_sessions/${encKey}/${sessionId}/status`] = 'resolved';
    updates[`tcc_user_sessions/${encKey}/${sessionId}/lastActivityTimestamp`] = nowMs;
    updates[`tcc_user_sessions/${encKey}/${sessionId}/lastActivity`] = nowIso;
  }

  await update(ref(rtdb), updates);
}

/**
 * Mark user session as read and update real-time read receipts & presence
 */
export async function markSessionAsRead(encodedEmail: string, sessionId: string): Promise<void> {
  try {
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const updates: Record<string, any> = {};
    updates[`tcc_user_sessions/${encodedEmail}/${sessionId}/unread`] = false;
    updates[`tcc_sessions/${sessionId}/participants/${encodedEmail}/lastReadTimestamp`] = nowMs;
    updates[`tcc_sessions/${sessionId}/participants/${encodedEmail}/lastSeen`] = nowIso;
    await update(ref(rtdb), updates);
  } catch (err) {
    console.error('Error marking session as read:', err);
  }
}

/**
 * Real-time subscription to user's conversation sessions (strictly latest 50)
 */
export function subscribeUserSessions(
  encodedEmail: string,
  onData: (sessions: TCCUserSessionSummary[]) => void
): () => void {
  const userSessionsRef = ref(rtdb, `tcc_user_sessions/${encodedEmail}`);
  const userSessionsQuery = query(userSessionsRef, orderByChild('lastActivityTimestamp'), limitToLast(50));

  const callback = (snap: any) => {
    const val = snap.val();
    if (!val) {
      onData([]);
      return;
    }
    const list: TCCUserSessionSummary[] = Object.keys(val).map((k) => ({
      ...val[k],
      sessionId: k,
    }));
    // Sort descending (newest activity first)
    list.sort((a, b) => (b.lastActivityTimestamp || 0) - (a.lastActivityTimestamp || 0));
    onData(list.slice(0, MAX_SESSIONS_PER_PERSONNEL));
  };

  onValue(userSessionsQuery, callback);

  return () => {
    off(userSessionsQuery, 'value', callback);
  };
}

/**
 * Real-time subscription to a single session's data & messages
 */
export function subscribeSession(
  sessionId: string,
  onData: (session: TCCSession | null) => void
): () => void {
  const sessionRef = ref(rtdb, `tcc_sessions/${sessionId}`);
  const callback = (snap: any) => {
    if (!snap.exists()) {
      onData(null);
      return;
    }
    onData(snap.val() as TCCSession);
  };

  onValue(sessionRef, callback);

  return () => {
    off(sessionRef, 'value', callback);
  };
}

/**
 * Real-time subscription to user notifications/pings
 */
export function subscribeUserNotifications(
  encodedEmail: string,
  onData: (notifications: TCCNotification[]) => void
): () => void {
  const notifRef = ref(rtdb, `tcc_notifications/${encodedEmail}`);
  const notifQuery = query(notifRef, orderByChild('timestampMs'), limitToLast(30));

  const callback = (snap: any) => {
    const val = snap.val();
    if (!val) {
      onData([]);
      return;
    }
    const list: TCCNotification[] = Object.keys(val).map((k) => ({
      ...val[k],
      id: k,
    }));
    list.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    onData(list);
  };

  onValue(notifQuery, callback);

  return () => {
    off(notifQuery, 'value', callback);
  };
}

/**
 * Dismiss / mark all notifications as read
 */
export async function clearUserNotifications(encodedEmail: string): Promise<void> {
  try {
    await remove(ref(rtdb, `tcc_notifications/${encodedEmail}`));
  } catch (err) {
    console.error('Failed to clear notifications:', err);
  }
}

/**
 * Permanently delete a TCC session and all its messages.
 * Authority: Admin Sr. ONLY.
 * Completely removes the session from tcc_sessions, cleans up every participant's
 * user_sessions index, and clears session notifications.
 */
export async function deleteTCCSession(params: {
  sessionId: string;
  adminProfile: ApprovedPersonnelInfo;
}): Promise<void> {
  const { sessionId, adminProfile } = params;

  if (adminProfile.role !== 'Admin Sr.') {
    throw new Error('Unauthorized: Only Admin Sr. can delete TCC sessions.');
  }

  // Fetch session data first to find all enrolled participants
  const sessionSnap = await get(ref(rtdb, `tcc_sessions/${sessionId}`));
  if (!sessionSnap.exists()) {
    return;
  }

  const session = sessionSnap.val() as TCCSession;
  const participants = session.participants || {};
  const updates: Record<string, any> = {};

  // 1. Entirely remove the session document (messages, disputeDetails, participants)
  updates[`tcc_sessions/${sessionId}`] = null;

  // 2. Remove from each participant's user_sessions index
  for (const [encEmail] of Object.entries(participants)) {
    updates[`tcc_user_sessions/${encEmail}/${sessionId}`] = null;
  }

  // 3. Clean up notifications referencing this session
  for (const [encEmail] of Object.entries(participants)) {
    try {
      const notifsSnap = await get(ref(rtdb, `tcc_notifications/${encEmail}`));
      if (notifsSnap.exists()) {
        const notifs = notifsSnap.val();
        for (const [nid, notif] of Object.entries(notifs)) {
          if ((notif as any)?.sessionId === sessionId) {
            updates[`tcc_notifications/${encEmail}/${nid}`] = null;
          }
        }
      }
    } catch (e) {
      console.error(`Error checking notifications for ${encEmail}:`, e);
    }
  }

  // Apply batch atomic deletion
  await update(ref(rtdb), updates);

  // Log audit event
  try {
    await logAuditEvent({
      actorEmail: adminProfile.email,
      actorName: adminProfile.name,
      actorRole: 'Admin Sr.',
      action: 'DELETE_TCC_SESSION' as any,
      actionLabel: 'Deleted TCC Session',
      targetTitle: session.title,
      details: {
        sessionId,
        type: session.type,
      },
    });
  } catch (e) {
    console.error('Failed to log session deletion audit event:', e);
  }
}

