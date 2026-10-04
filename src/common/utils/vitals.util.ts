export type VitalSeverity = 'NORMAL' | 'MILD' | 'MODERATE' | 'CRITICAL';

export interface VitalInput {
  ageMonths: number;
  heartRateBpm?: number | null;
  respiratoryRateBpm?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  spo2Percent?: number | null;
  temperatureC?: number | null;
  capillaryRefillSec?: number | null;
  painScore?: number | null;
  avpu?: 'ALERT' | 'VERBAL' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE' | null;
}

export interface VitalFinding {
  vital: string;
  value: number | string;
  severity: VitalSeverity;
  reason: string;
}

export interface VitalEvaluationResult {
  overallSeverity: VitalSeverity;
  findings: VitalFinding[];
  hasMissingDataWarning: boolean;
  warnings: string[];
}

/**
 * WHO/PALS 2020 pediatric normative vital thresholds by age band.
 */
interface AgeBandNorm {
  minAgeMonths: number;
  maxAgeMonths: number;
  hr: { lowCrit: number; lowNorm: number; highNorm: number; highCrit: number };
  rr: { lowCrit: number; lowNorm: number; highNorm: number; highCrit: number };
}

const AGE_BAND_NORMS: AgeBandNorm[] = [
  {
    minAgeMonths: 0,
    maxAgeMonths: 1,
    hr: { lowCrit: 80, lowNorm: 100, highNorm: 180, highCrit: 205 },
    rr: { lowCrit: 25, lowNorm: 30, highNorm: 60, highCrit: 70 },
  },
  {
    minAgeMonths: 1,
    maxAgeMonths: 12,
    hr: { lowCrit: 70, lowNorm: 100, highNorm: 160, highCrit: 180 },
    rr: { lowCrit: 20, lowNorm: 30, highNorm: 50, highCrit: 60 },
  },
  {
    minAgeMonths: 12,
    maxAgeMonths: 36,
    hr: { lowCrit: 60, lowNorm: 90, highNorm: 150, highCrit: 165 },
    rr: { lowCrit: 16, lowNorm: 24, highNorm: 40, highCrit: 50 },
  },
  {
    minAgeMonths: 36,
    maxAgeMonths: 72,
    hr: { lowCrit: 60, lowNorm: 80, highNorm: 140, highCrit: 150 },
    rr: { lowCrit: 14, lowNorm: 22, highNorm: 34, highCrit: 40 },
  },
  {
    minAgeMonths: 72,
    maxAgeMonths: 144,
    hr: { lowCrit: 50, lowNorm: 70, highNorm: 120, highCrit: 135 },
    rr: { lowCrit: 12, lowNorm: 18, highNorm: 30, highCrit: 35 },
  },
  {
    minAgeMonths: 144,
    maxAgeMonths: 240,
    hr: { lowCrit: 45, lowNorm: 60, highNorm: 100, highCrit: 120 },
    rr: { lowCrit: 10, lowNorm: 12, highNorm: 20, highCrit: 25 },
  },
];

const SEVERITY_ORDER: Record<VitalSeverity, number> = {
  NORMAL: 0,
  MILD: 1,
  MODERATE: 2,
  CRITICAL: 3,
};

export function getMaxSeverity(
  a: VitalSeverity,
  b: VitalSeverity,
): VitalSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

export function evaluateVitals(input: VitalInput): VitalEvaluationResult {
  const findings: VitalFinding[] = [];
  const warnings: string[] = [];
  let overallSeverity: VitalSeverity = 'NORMAL';

  const age = Number.isFinite(input.ageMonths) ? input.ageMonths : 0;
  const norm =
    AGE_BAND_NORMS.find((b) => age >= b.minAgeMonths && age < b.maxAgeMonths) ||
    AGE_BAND_NORMS[AGE_BAND_NORMS.length - 1];

  // 1. SpO2 (Oxygen Saturation)
  if (input.spo2Percent != null && Number.isFinite(input.spo2Percent)) {
    const spo2 = input.spo2Percent;
    if (spo2 < 90) {
      findings.push({
        vital: 'SpO2',
        value: `${spo2}%`,
        severity: 'CRITICAL',
        reason: `Severe hypoxemia (SpO2 ${spo2}% < 90%)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (spo2 <= 94) {
      findings.push({
        vital: 'SpO2',
        value: `${spo2}%`,
        severity: 'MODERATE',
        reason: `Hypoxemia (SpO2 ${spo2}%, target >= 95%)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    }
  } else {
    warnings.push('SpO2 not recorded');
  }

  // 2. AVPU (Consciousness)
  if (input.avpu) {
    if (input.avpu === 'UNRESPONSIVE') {
      findings.push({
        vital: 'AVPU',
        value: input.avpu,
        severity: 'CRITICAL',
        reason: 'Unresponsive (AVPU: U)',
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (
      input.avpu === 'PAIN' ||
      input.avpu === 'VOICE' ||
      input.avpu === 'VERBAL'
    ) {
      findings.push({
        vital: 'AVPU',
        value: input.avpu,
        severity: 'CRITICAL',
        reason: `Altered mental status (AVPU: ${input.avpu})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    }
  }

  // 3. Capillary Refill Time
  if (
    input.capillaryRefillSec != null &&
    Number.isFinite(input.capillaryRefillSec)
  ) {
    const crt = input.capillaryRefillSec;
    if (crt > 3.0) {
      findings.push({
        vital: 'CRT',
        value: `${crt}s`,
        severity: 'CRITICAL',
        reason: `Prolonged capillary refill (>3s: ${crt}s) - signs of shock`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (crt > 2.0) {
      findings.push({
        vital: 'CRT',
        value: `${crt}s`,
        severity: 'MODERATE',
        reason: `Delayed capillary refill (2-3s: ${crt}s)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    }
  }

  // 4. Heart Rate
  if (input.heartRateBpm != null && Number.isFinite(input.heartRateBpm)) {
    const hr = input.heartRateBpm;
    if (hr >= norm.hr.highCrit) {
      findings.push({
        vital: 'HR',
        value: `${hr} bpm`,
        severity: 'CRITICAL',
        reason: `Extreme tachycardia (${hr} bpm >= ${norm.hr.highCrit})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (hr <= norm.hr.lowCrit) {
      findings.push({
        vital: 'HR',
        value: `${hr} bpm`,
        severity: 'CRITICAL',
        reason: `Extreme bradycardia (${hr} bpm <= ${norm.hr.lowCrit})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (hr > norm.hr.highNorm) {
      findings.push({
        vital: 'HR',
        value: `${hr} bpm`,
        severity: 'MODERATE',
        reason: `Tachycardia (${hr} bpm > normal ${norm.hr.highNorm})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    } else if (hr < norm.hr.lowNorm) {
      findings.push({
        vital: 'HR',
        value: `${hr} bpm`,
        severity: 'MODERATE',
        reason: `Bradycardia (${hr} bpm < normal ${norm.hr.lowNorm})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    }
  }

  // 5. Respiratory Rate
  if (
    input.respiratoryRateBpm != null &&
    Number.isFinite(input.respiratoryRateBpm)
  ) {
    const rr = input.respiratoryRateBpm;
    if (rr >= norm.rr.highCrit) {
      findings.push({
        vital: 'RR',
        value: `${rr}/min`,
        severity: 'CRITICAL',
        reason: `Severe tachypnea (${rr}/min >= ${norm.rr.highCrit})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (rr <= norm.rr.lowCrit) {
      findings.push({
        vital: 'RR',
        value: `${rr}/min`,
        severity: 'CRITICAL',
        reason: `Severe bradypnea/hypoventilation (${rr}/min <= ${norm.rr.lowCrit})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'CRITICAL');
    } else if (rr > norm.rr.highNorm) {
      findings.push({
        vital: 'RR',
        value: `${rr}/min`,
        severity: 'MODERATE',
        reason: `Tachypnea (${rr}/min > normal ${norm.rr.highNorm})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    } else if (rr < norm.rr.lowNorm) {
      findings.push({
        vital: 'RR',
        value: `${rr}/min`,
        severity: 'MODERATE',
        reason: `Bradypnea (${rr}/min < normal ${norm.rr.lowNorm})`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    }
  }

  // 6. Temperature
  if (input.temperatureC != null && Number.isFinite(input.temperatureC)) {
    const temp = input.temperatureC;
    if (temp >= 39.5) {
      findings.push({
        vital: 'Temp',
        value: `${temp}°C`,
        severity: 'MODERATE',
        reason: `High fever (temperature ${temp}°C >= 39.5°C)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    } else if (temp <= 35.5) {
      findings.push({
        vital: 'Temp',
        value: `${temp}°C`,
        severity: 'MODERATE',
        reason: `Hypothermia (temperature ${temp}°C <= 35.5°C)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MODERATE');
    } else if (temp >= 38.0) {
      findings.push({
        vital: 'Temp',
        value: `${temp}°C`,
        severity: 'MILD',
        reason: `Fever (temperature ${temp}°C >= 38.0°C)`,
      });
      overallSeverity = getMaxSeverity(overallSeverity, 'MILD');
    }
  }

  return {
    overallSeverity,
    findings,
    hasMissingDataWarning: warnings.length > 0,
    warnings,
  };
}
