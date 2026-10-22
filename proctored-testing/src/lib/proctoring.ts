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
  evidenceSnapshot?: string; // Optional lightweight base64 JPEG thumbnail for visual proof
  confidence?: number;
}

export function isHardViolation(event: ProctoringEvent): boolean {
  return (
    event === 'TAB_SWITCHED' ||
    event === 'LEFT_FULLSCREEN' ||
    event === 'MULTIPLE_FACES' ||
    event === 'PHONE_DETECTED' ||
    event === 'CAMERA_COVERED' ||
    event === 'MIC_MUTED'
  );
}

/**
 * Calculates a fair, transparent Integrity Score from 0 to 100%.
 * Soft posture / gaze changes do not destroy candidate scores;
 * hard intentional violations carry appropriate weight.
 */
export function calculateIntegrityScore(flags: DurationFlag[]): number {
  if (!flags || flags.length === 0) return 100;

  let deduction = 0;
  let softDurationSecs = 0;

  for (const f of flags) {
    if (isHardViolation(f.event)) {
      if (f.event === 'TAB_SWITCHED' || f.event === 'LEFT_FULLSCREEN') {
        deduction += Math.min(20, 8 + Math.floor((f.durationInSeconds || 1) * 2));
      } else if (f.event === 'MULTIPLE_FACES') {
        deduction += Math.min(25, 12 + Math.floor((f.durationInSeconds || 1) * 3));
      } else if (f.event === 'PHONE_DETECTED') {
        deduction += Math.min(30, 15 + Math.floor((f.durationInSeconds || 1) * 3));
      } else if (f.event === 'CAMERA_COVERED') {
        deduction += Math.min(20, 10 + Math.floor((f.durationInSeconds || 1) * 2));
      } else {
        deduction += 10;
      }
    } else {
      softDurationSecs += f.durationInSeconds || 0;
    }
  }

  // Soft telemetry deduction: 1 point per 20 seconds of sustained deviation, max 25 points
  const softDeduction = Math.min(25, Math.floor(softDurationSecs / 20));
  deduction += softDeduction;

  return Math.max(0, Math.min(100, 100 - deduction));
}

export function reportFlag(uid: string, flag: DurationFlag) {
  const flagsRef = ref(rtdb, `proctoringFlags/${uid}`);
  push(flagsRef, flag);
}
