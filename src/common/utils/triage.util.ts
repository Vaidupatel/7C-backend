import { VitalSeverity } from './vitals.util.js';

export type TriageLevel = 'EMERGENCY' | 'PRIORITY' | 'ROUTINE';

export type ReasonSource =
  | 'SIGNS'
  | 'VITALS'
  | 'GROWTH'
  | 'WARNING'
  | 'WAIT_TIME'
  | 'OVERRIDE'
  | 'SYSTEM';

export interface StructuredReason {
  code: string;
  severity: 'EMERGENCY' | 'PRIORITY' | 'ROUTINE' | 'INFO';
  label: string;
  source: ReasonSource;
}

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
  reasons: StructuredReason[];
  explanation: string[];
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
 * - Structured explainability ({ code, severity, label, source }) (F7).
 */
export function calculateTriage(input: TriageInput): TriageOutput {
  const reasons: StructuredReason[] = [];
  let isEmergency = false;
  let isPriority = false;

  // 1. Signs evaluation
  for (const sign of input.signs) {
    if (sign.redFlagLevel === 'EMERGENCY') {
      isEmergency = true;
      reasons.push({
        code: `SIGN_EMERGENCY_${sign.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
        severity: 'EMERGENCY',
        label: `Emergency red flag sign: ${sign.name}`,
        source: 'SIGNS',
      });
    } else if (sign.redFlagLevel === 'PRIORITY') {
      isPriority = true;
      reasons.push({
        code: `SIGN_PRIORITY_${sign.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
        severity: 'PRIORITY',
        label: `Priority red flag sign: ${sign.name}`,
        source: 'SIGNS',
      });
    }
  }

  // 2. Vitals evaluation
  if (input.vitalsSeverity === 'CRITICAL') {
    isEmergency = true;
    for (const r of input.vitalsReasons) {
      reasons.push({
        code: 'VITAL_CRITICAL',
        severity: 'EMERGENCY',
        label: `Critical vital: ${r}`,
        source: 'VITALS',
      });
    }
  } else if (
    input.vitalsSeverity === 'MODERATE' ||
    input.vitalsSeverity === 'MILD'
  ) {
    isPriority = true;
    for (const r of input.vitalsReasons) {
      reasons.push({
        code: 'VITAL_ABNORMAL',
        severity: 'PRIORITY',
        label: `Abnormal vital: ${r}`,
        source: 'VITALS',
      });
    }
  }

  // 3. Growth flags evaluation (source === 'GROWTH')
  if (input.growthFlags && input.growthFlags.length > 0) {
    for (const g of input.growthFlags) {
      if (g.severity === 'EMERGENCY') {
        isEmergency = true;
        reasons.push({
          code: 'GROWTH_FLAG_SEVERE',
          severity: 'EMERGENCY',
          label: `Severe growth flag: ${g.label}`,
          source: 'GROWTH',
        });
      } else if (g.severity === 'PRIORITY') {
        isPriority = true;
        reasons.push({
          code: 'GROWTH_FLAG_ALERT',
          severity: 'PRIORITY',
          label: `Growth alert: ${g.label}`,
          source: 'GROWTH',
        });
      }
    }
  }

  // 4. Missing data warnings (Safety bias)
  if (input.missingDataWarnings && input.missingDataWarnings.length > 0) {
    for (const w of input.missingDataWarnings) {
      reasons.push({
        code: 'MISSING_DATA_WARNING',
        severity: 'PRIORITY',
        label: `Missing data warning: ${w}`,
        source: 'WARNING',
      });
    }
  }

  // 5. Determine base level
  let level: TriageLevel = 'ROUTINE';
  if (isEmergency) {
    level = 'EMERGENCY';
  } else if (isPriority) {
    level = 'PRIORITY';
  } else if (
    input.missingDataWarnings &&
    input.missingDataWarnings.length > 0
  ) {
    // Safety bias (Finding C4 & Clinical Rule 5): Missing vital data raises ROUTINE to PRIORITY
    level = 'PRIORITY';
    reasons.push({
      code: 'SAFETY_BIAS_ESCALATION',
      severity: 'PRIORITY',
      label:
        'Safety bias escalation: missing or incomplete vital data requires clinical assessment',
      source: 'WARNING',
    });
  }

  // 6. Waiting time escalation
  const wait = Math.max(0, input.waitingMinutes || 0);
  if (level === 'ROUTINE' && wait >= 60) {
    level = 'PRIORITY';
    reasons.push({
      code: 'WAITING_TIME_ESCALATION',
      severity: 'PRIORITY',
      label: `Waiting time escalation: waited ${wait} minutes (> 60m threshold)`,
      source: 'WAIT_TIME',
    });
  }

  // Ensure reasons are never empty above ROUTINE
  if (level !== 'ROUTINE' && reasons.length === 0) {
    reasons.push({
      code: 'CLINICAL_PRIORITY_INDICATED',
      severity: level,
      label: 'Clinical priority indicated',
      source: 'SYSTEM',
    });
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
    explanation: reasons.map((r) => r.label),
    configVersion: TRIAGE_CONFIG_VERSION,
  };
}
