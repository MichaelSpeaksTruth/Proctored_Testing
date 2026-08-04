import { ref, push } from 'firebase/database';
import { rtdb } from './firebase';

export type ProctoringEvent =
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'TAB_SWITCHED'
  | 'EXITED_FULLSCREEN'
  | 'REPEATED_FULLSCREEN_EXIT'
  | 'LOUD_AUDIO'
  | 'CAMERA_COVERED'
  | 'PHONE_DETECTED';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ProctoringFlag {
  event: ProctoringEvent;
  severity: Severity;
  timestamp: string;
}

export function reportFlag(uid: string, event: ProctoringEvent, severity: Severity) {
  const flagsRef = ref(rtdb, `proctoringFlags/${uid}`);
  push(flagsRef, {
    event,
    severity,
    timestamp: new Date().toISOString(),
  });
}
