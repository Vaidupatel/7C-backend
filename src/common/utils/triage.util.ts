import { VitalSeverity } from './vitals.util.js';

export type TriageLevel = 'EMERGENCY' | 'PRIORITY' | 'ROUTINE';

export interface TriageInput {
  vitalsSeverity: VitalSeverity;
  vitalsReasons: string[];
  signs: Array<{
    name: string;
    redFlagLevel: 'NONE' | 'PRIORITY' | 'EMERGENCY';
  }>;
  growthFlags?: Array<{
    severity: 'NORMAL' | 'PRIORITY' | 'EMERGENCY';
    label: string;
  }>;
  waitingMinutes?: number;
  missingDataWarnings?: string[];
}

export interface TriageOutput {
  level: TriageLevel;
  score: number;
  reasons: string[];
  configVersion: string;
}

export const TRIAGE_CONFIG_VERSION = '2026.1-peds-opd';

/**
 * Pure Triage Engine for 7 Colour Pediatric OPD.
 * Clinical Decision Support:
 * - Highest component wins (Vitals, Signs, Growth flags), NEVER an average.
 * - Missing or implausible data raises priority/warnings, never silently ignored.
 * - Waiting time escalation: Routine > 60m escalates to Priority.
 * - Deterministic score for queue ordering.
 */
export function calculateTriage(input: TriageInput): TriageOutput {
  const reasons: string[] = [];
  let isEmergency = false;
  let isPriority = false;

  // 1. Signs evaluation
  for (const sign of input.signs) {
    if (sign.redFlagLevel === 'EMERGENCY') {
      isEmergency = true;
      reasons.push(`Emergency red flag sign: ${sign.name}`);
    } else if (sign.redFlagLevel === 'PRIORITY') {
      isPriority = true;
      reasons.push(`Priority red flag sign: ${sign.name}`);
    }
  }

  // 2. Vitals evaluation
  if (input.vitalsSeverity === 'CRITICAL') {
    isEmergency = true;
    for (const r of input.vitalsReasons) {
      reasons.push(`Critical vital: ${r}`);
    }
  } else if (
    input.vitalsSeverity === 'MODERATE' ||
    input.vitalsSeverity === 'MILD'
  ) {
    isPriority = true;
    for (const r of input.vitalsReasons) {
      reasons.push(`Abnormal vital: ${r}`);
    }
  }

  // 3. Growth flags evaluation
  if (input.growthFlags && input.growthFlags.length > 0) {
    for (const g of input.growthFlags) {
      if (g.severity === 'EMERGENCY') {
        isEmergency = true;
        reasons.push(`Severe growth flag: ${g.label}`);
      } else if (g.severity === 'PRIORITY') {
        isPriority = true;
        reasons.push(`Growth alert: ${g.label}`);
      }
    }
  }

  // 4. Missing data warnings (Safety bias)
  if (input.missingDataWarnings && input.missingDataWarnings.length > 0) {
    for (const w of input.missingDataWarnings) {
      reasons.push(`Missing data warning: ${w}`);
    }
  }

  // 5. Determine base level
  let level: TriageLevel = 'ROUTINE';
  if (isEmergency) {
    level = 'EMERGENCY';
  } else if (isPriority) {
    level = 'PRIORITY';
  }

  // 6. Waiting time escalation
  const wait = Math.max(0, input.waitingMinutes || 0);
  if (level === 'ROUTINE' && wait >= 60) {
    level = 'PRIORITY';
    reasons.push(
      `Waiting time escalation: waited ${wait} minutes (> 60m threshold)`,
    );
  }

  // Ensure reasons are never empty above ROUTINE
  if (level !== 'ROUTINE' && reasons.length === 0) {
    reasons.push('Clinical priority indicated');
  }

  // 7. Calculate score
  let baseScore = 1000;
  if (level === 'EMERGENCY') {
    baseScore = 3000 + Math.min(wait * 5, 500);
  } else if (level === 'PRIORITY') {
    baseScore = 2000 + Math.min(wait * 3, 500);
  } else {
    baseScore = 1000 + Math.min(wait, 500);
  }

  return {
    level,
    score: baseScore,
    reasons,
    configVersion: TRIAGE_CONFIG_VERSION,
  };
}
