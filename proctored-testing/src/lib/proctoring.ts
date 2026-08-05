import { ref, push } from 'firebase/database';
import { rtdb } from './firebase';

export type ProctoringEvent =
  | 'INVALID_FACE_COUNT'
  | 'TAB_SWITCHED'
  | 'LEFT_FULLSCREEN'
  | 'LOUD_AUDIO'
  | 'CAMERA_COVERED'
  | 'MIC_MUTED'
  | 'PHONE_DETECTED'
  | 'GAZE_AWAY';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface DurationFlag {
  event: ProctoringEvent;
  severity: Severity;
  startTime: string;
  endTime: string;
  durationInSeconds: number;
}

export function reportFlag(uid: string, flag: DurationFlag) {
  const flagsRef = ref(rtdb, `proctoringFlags/${uid}`);
  push(flagsRef, flag);
}
