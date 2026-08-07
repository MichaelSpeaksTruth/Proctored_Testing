import { ref, push } from 'firebase/database';
import { rtdb } from './firebase';

export type ProctoringEvent =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'TAB_SWITCHED'
  | 'LEFT_FULLSCREEN'
  | 'LOUD_AUDIO'
  | 'CAMERA_COVERED'
  | 'MIC_MUTED'
  | 'PHONE_DETECTED'
  | 'GAZE_AWAY'
  | 'HEAD_PITCH_DOWN'
  | 'DUCKING_DOWN'
  | 'SHOULDERS_OUT_OF_FRAME';

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
