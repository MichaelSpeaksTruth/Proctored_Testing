import { rtdb } from '@/lib/firebase';
import { ref, push, set } from 'firebase/database';

export interface AuditEvent {
  id: string;
  timestamp: string; // ISO string
  actorEmail: string;
  actorName: string;
  actorRole: 'Admin Sr.' | 'Question Setter' | 'Admin L1' | string;
  action:
    | 'ADD_QUESTION'
    | 'EDIT_QUESTION'
    | 'DELETE_QUESTION'
    | 'ADD_SECTION'
    | 'UPDATE_SECTION'
    | 'DELETE_SECTION'
    | 'CREATE_TEST'
    | 'DELETE_TEST'
    | 'SUBMIT_SOLUTIONS'
    | 'APPROVE_PERSONNEL'
    | 'REJECT_PERSONNEL'
    | 'REVOKE_PERSONNEL'
    | 'ADD_PARTICIPANT'
    | 'BULK_ADD_PARTICIPANTS'
    | 'DELETE_PARTICIPANT';
  actionLabel: string;
  targetTitle: string;
  details?: {
    testId?: string;
    testTitle?: string;
    sectionId?: string;
    sectionName?: string;
    questionTag?: string;
    questionSnippet?: string;
    targetEmail?: string;
    targetRole?: string;
    targetName?: string;
    participantEmail?: string;
    participantName?: string;
    count?: number;
    [key: string]: any;
  };
}

export async function logAuditEvent(
  event: Omit<AuditEvent, 'id' | 'timestamp'>
): Promise<boolean> {
  try {
    const logsRef = ref(rtdb, 'audit_logs');
    const newLogRef = push(logsRef);
    const fullEvent: AuditEvent = {
      ...event,
      id: newLogRef.key || `evt_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await set(newLogRef, fullEvent);
    return true;
  } catch (err) {
    console.error('Failed to log audit event:', err);
    return false;
  }
}
