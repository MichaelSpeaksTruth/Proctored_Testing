import { ref, push } from 'firebase/database';
import { rtdb } from './firebase';

export const FRAMES_TO_START = 16;
export const FRAMES_TO_CLEAR = 18;

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
  | 'SHOULDERS_OUT_OF_FRAME'
  | 'FACE_OCCLUDED'
  | 'POSSIBLE_EXTRA_FACE';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type Box = [number, number, number, number]; // [x, y, w, h] in video pixels

export interface PhoneMeta {
  score: number;
  box: Box;
  frameW: number;
  frameH: number;
  maxStaticMs: number;
  suppressedAsStatic?: boolean; // only set when true (RTDB rejects undefined)
}

export interface DurationFlag {
  event: ProctoringEvent;
  severity: Severity;
  startTime: string;
  endTime: string;
  durationInSeconds: number;
  evidenceSnapshot?: string; // Optional lightweight base64 JPEG thumbnail with burned-in box
  detection?: PhoneMeta;
  confidence?: number;
}

export function isHardViolation(event: ProctoringEvent): boolean {
  return (
    event === 'TAB_SWITCHED' ||
    event === 'LEFT_FULLSCREEN' ||
    event === 'MULTIPLE_FACES' ||
    event === 'PHONE_DETECTED' ||
    event === 'CAMERA_COVERED'
  );
}

/**
 * Calculates a fair, transparent Integrity Score from 0 to 100%.
 * Soft posture / gaze changes do not destroy candidate scores;
 * hard intentional violations carry appropriate weight.
 * Flags marked with suppressedAsStatic are not penalized as hard cheats.
 */
export function calculateIntegrityScore(flags: DurationFlag[]): number {
  if (!flags || flags.length === 0) return 100;

  let deduction = 0;
  let softDurationSecs = 0;

  for (const f of flags) {
    if (f.event === 'TAB_SWITCHED') {
      deduction += 20;
    } else if (f.event === 'LEFT_FULLSCREEN') {
      deduction += 15;
    } else if (f.event === 'MULTIPLE_FACES') {
      deduction += 25;
    } else if (f.event === 'PHONE_DETECTED') {
      // If the detection was suppressed as a static background object, do not penalize heavily
      if (f.detection?.suppressedAsStatic) {
        deduction += 5;
      } else {
        deduction += 35;
      }
    } else if (f.event === 'CAMERA_COVERED') {
      deduction += 25;
    } else if (f.event === 'MIC_MUTED' || f.event === 'LOUD_AUDIO') {
      // Mic eradicated: 0 point deduction (no charge for mic/audio)
      deduction += 0;
    } else if (f.event === 'FACE_OCCLUDED' || f.event === 'POSSIBLE_EXTRA_FACE') {
      // Review-only signals: minimal deduction (2 points) for reviewer triage without unfairly penalizing candidates
      deduction += 2;
    } else {
      softDurationSecs += f.durationInSeconds;
    }
  }

  // Soft telemetry deduction: max 15 points total across entire exam
  const softDeduction = Math.min(15, Math.floor(softDurationSecs / 10));
  deduction += softDeduction;

  return Math.max(0, 100 - deduction);
}
