/**
 * 7 Colour HMS - Pure Clinical Growth Math Engine
 *
 * Implements CDC and WHO LMS (Lambda-Mu-Sigma) growth calculations.
 * Reference: CDC Growth Charts (cdc.gov/growthcharts/cdc-charts.htm)
 * Formula:
 *   Z = ((X / M)^L - 1) / (L * S)  when L != 0
 *   Z = ln(X / M) / S              when L == 0
 *
 * Inverse Formula:
 *   X = M * (1 + L * S * Z)^(1 / L) when L != 0
 *   X = M * exp(S * Z)             when L == 0
 *
 * Standalone pure logic with zero I/O, covered by unit tests.
 */

export interface LmsParams {
  l: number;
  m: number;
  s: number;
}

export type GrowthSeverity = 'NORMAL' | 'PRIORITY' | 'EMERGENCY';

export interface GrowthEvaluationResult {
  measure: string;
  value: number;
  zScore: number;
  percentile: number;
  isExtreme: boolean;
  isImplausible?: boolean;
  clinicalFlag?: string;
  severity: GrowthSeverity;
}

export interface MidParentalHeightResult {
  targetHeightCm: number;
  targetHeightRangeLowCm: number;
  targetHeightRangeHighCm: number;
  formulaDescription: string;
}

export interface PercentileCrossingResult {
  crossed: boolean;
  direction?: 'DOWNWARD' | 'UPWARD';
  channelsCrossed: number;
  severity: GrowthSeverity;
  clinicalFlag?: string;
}

/**
 * Standard CDC/WHO major percentile channel lines:
 * 3rd, 5th, 10th, 25th, 50th, 75th, 90th, 95th, 97th.
 */
export const MAJOR_PERCENTILE_CHANNELS = [3, 5, 10, 25, 50, 75, 90, 95, 97];

/**
 * Calculates standard normal cumulative distribution function error function erf(x).
 * Using Abramowitz and Stegun approximation (formula 7.1.26), accurate to 1.5e-7.
 */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1.0 / (1.0 + p * a);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);
  return sign * y;
}

/**
 * Converts a standard normal Z-score into a percentile between 0.1 and 99.9.
 */
export function zScoreToPercentile(zScore: number): number {
  if (!Number.isFinite(zScore) || isNaN(zScore)) return 50.0;
  // Standard normal CDF: Phi(z) = 0.5 * (1 + erf(z / sqrt(2)))
  const cdf = 0.5 * (1 + erf(zScore / Math.SQRT2));
  const rawPct = cdf * 100;
  // Clamp display between 0.1% and 99.9%
  const clamped = Math.max(0.1, Math.min(99.9, rawPct));
  return Math.round(clamped * 10) / 10;
}

/**
 * Calculates Z-score given a measurement value X and LMS parameters.
 * Safety bias: invalid or non-positive measurements return extreme/implausible flags.
 */
export function calculateLmsZScore(
  x: number,
  lms: LmsParams,
): { zScore: number; isExtreme: boolean; isImplausible?: boolean } {
  if (
    !Number.isFinite(x) ||
    x <= 0 ||
    !lms ||
    !Number.isFinite(lms.m) ||
    lms.m <= 0 ||
    !Number.isFinite(lms.s) ||
    lms.s <= 0 ||
    !Number.isFinite(lms.l)
  ) {
    return { zScore: 0, isExtreme: true, isImplausible: true };
  }

  const { l, m, s } = lms;
  let z: number;

  if (Math.abs(l) < 0.00001) {
    z = Math.log(x / m) / s;
  } else {
    const ratio = x / m;
    if (ratio <= 0) {
      return { zScore: 0, isExtreme: true, isImplausible: true };
    }
    z = (Math.pow(ratio, l) - 1) / (l * s);
  }

  if (!Number.isFinite(z) || isNaN(z)) {
    return { zScore: 0, isExtreme: true, isImplausible: true };
  }

  const roundedZ = Math.round(z * 1000) / 1000;
  const isExtreme = Math.abs(roundedZ) > 4.0;

  return { zScore: roundedZ, isExtreme, isImplausible: false };
}

/**
 * Inverse LMS: calculates measurement value X for a target Z-score.
 */
export function calculateLmsValue(z: number, lms: LmsParams): number {
  if (
    !Number.isFinite(z) ||
    !lms ||
    !Number.isFinite(lms.m) ||
    lms.m <= 0 ||
    !Number.isFinite(lms.s) ||
    lms.s <= 0 ||
    !Number.isFinite(lms.l)
  ) {
    return 0;
  }

  const { l, m, s } = lms;
  let x: number;
  if (Math.abs(l) < 0.00001) {
    x = m * Math.exp(s * z);
  } else {
    const base = 1 + l * s * z;
    if (base <= 0) {
      return 0;
    }
    x = m * Math.pow(base, 1 / l);
  }

  if (!Number.isFinite(x) || isNaN(x) || x < 0) {
    return 0;
  }

  return Math.round(x * 100) / 100;
}

/**
 * Calculates Mid-Parental Height (Target Stature) for a child.
 * Tanner method:
 * - Boys:  (Father's height + Mother's height + 13 cm) / 2
 * - Girls: (Father's height + Mother's height - 13 cm) / 2
 * Target range is +/- 5.0 cm (or ~8.5 cm for 3rd-97th percentile envelope).
 * Guarded against implausible adult values (< 80 cm or > 250 cm or NaN).
 */
export function calculateMidParentalHeight(
  sex: 'MALE' | 'FEMALE',
  fatherStatureCm?: number | null,
  motherStatureCm?: number | null,
): MidParentalHeightResult | null {
  if (
    fatherStatureCm == null ||
    motherStatureCm == null ||
    !Number.isFinite(fatherStatureCm) ||
    !Number.isFinite(motherStatureCm) ||
    fatherStatureCm < 80 ||
    fatherStatureCm > 250 ||
    motherStatureCm < 80 ||
    motherStatureCm > 250
  ) {
    return null;
  }

  const offset = sex === 'MALE' ? 13 : -13;
  const target =
    Math.round(((fatherStatureCm + motherStatureCm + offset) / 2) * 10) / 10;

  return {
    targetHeightCm: target,
    targetHeightRangeLowCm: Math.round((target - 5.0) * 10) / 10,
    targetHeightRangeHighCm: Math.round((target + 5.0) * 10) / 10,
    formulaDescription:
      sex === 'MALE'
        ? '(Father + Mother + 13 cm) / 2'
        : '(Father + Mother - 13 cm) / 2',
  };
}

/**
 * Detects whether a child crossed 2 or more major percentile channels across visits.
 * Standard pediatric clinical definition of growth faltering / failure to thrive (FTT):
 * Crossing 2 or more major percentile lines downward (e.g. from 50th to below 10th).
 */
export function detectPercentileCrossing(
  previousPercentile: number,
  currentPercentile: number,
): PercentileCrossingResult {
  if (
    !Number.isFinite(previousPercentile) ||
    !Number.isFinite(currentPercentile) ||
    previousPercentile <= 0 ||
    currentPercentile <= 0
  ) {
    return { crossed: false, channelsCrossed: 0, severity: 'NORMAL' };
  }

  const diff = currentPercentile - previousPercentile;
  if (Math.abs(diff) < 1.0) {
    return { crossed: false, channelsCrossed: 0, severity: 'NORMAL' };
  }

  const minPct = Math.min(previousPercentile, currentPercentile);
  const maxPct = Math.max(previousPercentile, currentPercentile);

  // Count how many major channel boundary lines lie strictly between minPct and maxPct
  const crossedChannels = MAJOR_PERCENTILE_CHANNELS.filter(
    (ch) => ch > minPct && ch <= maxPct,
  );
  const channelsCount = crossedChannels.length;

  if (channelsCount >= 2) {
    if (diff < 0) {
      // Downward crossing
      const isSevere = currentPercentile < 3.0;
      return {
        crossed: true,
        direction: 'DOWNWARD',
        channelsCrossed: channelsCount,
        severity: isSevere ? 'EMERGENCY' : 'PRIORITY',
        clinicalFlag: `Growth Faltering: Dropped across ${channelsCount} major percentile channels (${previousPercentile}% → ${currentPercentile}%)`,
      };
    } else {
      // Upward crossing
      return {
        crossed: true,
        direction: 'UPWARD',
        channelsCrossed: channelsCount,
        severity: 'PRIORITY',
        clinicalFlag: `Rapid Growth Acceleration: Crossed ${channelsCount} major percentile channels upward (${previousPercentile}% → ${currentPercentile}%)`,
      };
    }
  }

  return { crossed: false, channelsCrossed: channelsCount, severity: 'NORMAL' };
}

/**
 * Evaluates clinical growth flags based on Z-scores and published WHO/CDC criteria.
 * Safety bias: implausible or NaN inputs raise PRIORITY with an explicit warning.
 */
export function evaluateGrowthFlag(
  measure: string,
  zScore: number,
  percentile: number,
): { clinicalFlag?: string; severity: GrowthSeverity } {
  if (
    !Number.isFinite(zScore) ||
    !Number.isFinite(percentile) ||
    isNaN(zScore)
  ) {
    return {
      clinicalFlag: 'Implausible or missing growth measurement',
      severity: 'PRIORITY',
    };
  }

  if (measure === 'WEIGHT_FOR_AGE') {
    if (zScore < -3.0) {
      return {
        clinicalFlag: 'Severe Underweight (Z < -3)',
        severity: 'EMERGENCY',
      };
    }
    if (zScore < -2.0 || percentile < 5.0) {
      return {
        clinicalFlag: 'Underweight (Z < -2 or < 5th %ile)',
        severity: 'PRIORITY',
      };
    }
    if (zScore > 2.0 || percentile > 95.0) {
      return {
        clinicalFlag: 'High Weight-for-Age (> 95th %ile)',
        severity: 'PRIORITY',
      };
    }
    return { severity: 'NORMAL' };
  }

  if (measure === 'LENGTH_FOR_AGE' || measure === 'STATURE_FOR_AGE') {
    if (zScore < -3.0) {
      return {
        clinicalFlag: 'Severe Stunting (Z < -3)',
        severity: 'EMERGENCY',
      };
    }
    if (zScore < -2.0 || percentile < 5.0) {
      return {
        clinicalFlag: 'Stunting / Short Stature (< 5th %ile)',
        severity: 'PRIORITY',
      };
    }
    if (zScore > 2.0 || percentile > 97.0) {
      return {
        clinicalFlag: 'Tall Stature (> 97th %ile)',
        severity: 'NORMAL',
      };
    }
    return { severity: 'NORMAL' };
  }

  if (measure === 'BMI_FOR_AGE' || measure === 'WEIGHT_FOR_LENGTH') {
    if (zScore < -3.0) {
      return {
        clinicalFlag: 'Severe Wasting (Z < -3)',
        severity: 'EMERGENCY',
      };
    }
    if (zScore < -2.0 || percentile < 5.0) {
      return {
        clinicalFlag: 'Wasting / Underweight (< 5th %ile)',
        severity: 'PRIORITY',
      };
    }
    if (percentile >= 95.0 || zScore >= 2.0) {
      return {
        clinicalFlag: 'Obesity (>= 95th %ile)',
        severity: 'PRIORITY',
      };
    }
    if (percentile >= 85.0 || zScore >= 1.0) {
      return {
        clinicalFlag: 'Overweight (>= 85th %ile)',
        severity: 'PRIORITY',
      };
    }
    return { severity: 'NORMAL' };
  }

  if (measure === 'HEAD_CIRCUMFERENCE_FOR_AGE') {
    if (zScore < -3.0) {
      return {
        clinicalFlag: 'Severe Microcephaly (Z < -3)',
        severity: 'EMERGENCY',
      };
    }
    if (zScore < -2.0 || percentile < 3.0) {
      return {
        clinicalFlag: 'Microcephaly (< 3rd %ile)',
        severity: 'PRIORITY',
      };
    }
    if (zScore > 2.0 || percentile > 97.0) {
      return {
        clinicalFlag: 'Macrocephaly (> 97th %ile)',
        severity: 'PRIORITY',
      };
    }
    return { severity: 'NORMAL' };
  }

  return { severity: 'NORMAL' };
}
