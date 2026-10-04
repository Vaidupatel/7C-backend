import {
  calculateLmsZScore,
  calculateLmsValue,
  zScoreToPercentile,
  calculateMidParentalHeight,
  evaluateGrowthFlag,
  detectPercentileCrossing,
  LmsParams,
} from './growth.util.js';

describe('Growth Utility (LMS Engine)', () => {
  describe('CDC Test Vector (Plan Section 3.2, 54)', () => {
    // CDC parameters for 9-month-old boy weight-for-age
    const cdc9moBoyLms: LmsParams = {
      l: -0.1600954,
      m: 9.476500305,
      s: 0.11218624,
    };

    it('matches exact CDC test vector: 9.7 kg yields z = 0.207 (~58th percentile)', () => {
      const { zScore, isExtreme, isImplausible } = calculateLmsZScore(
        9.7,
        cdc9moBoyLms,
      );
      expect(zScore).toBeCloseTo(0.207, 3);
      expect(isExtreme).toBe(false);
      expect(isImplausible).toBe(false);

      const percentile = zScoreToPercentile(zScore);
      expect(percentile).toBeCloseTo(58.2, 1);
    });

    it('matches exact CDC 5th percentile value: z = -1.645 yields 7.90 kg', () => {
      const weight5th = calculateLmsValue(-1.645, cdc9moBoyLms);
      expect(weight5th).toBe(7.9);
    });

    it('matches exact median (50th percentile, z = 0) to parameter M', () => {
      const weight50th = calculateLmsValue(0, cdc9moBoyLms);
      expect(weight50th).toBe(9.48); // M = 9.4765 -> 9.48
    });
  });

  describe('LMS Edge Cases and Safety Bias', () => {
    it('handles L = 0 (log-normal distribution)', () => {
      const logNormalLms: LmsParams = {
        l: 0.0,
        m: 10.0,
        s: 0.1,
      };

      const atMedian = calculateLmsZScore(10.0, logNormalLms);
      expect(atMedian.zScore).toBe(0);

      const valAtZ0 = calculateLmsValue(0, logNormalLms);
      expect(valAtZ0).toBe(10.0);
    });

    it('flags biologically extreme values when |z| > 4', () => {
      const cdc9moBoyLms: LmsParams = {
        l: -0.1600954,
        m: 9.476500305,
        s: 0.11218624,
      };

      const extremeLow = calculateLmsZScore(2.5, cdc9moBoyLms);
      expect(extremeLow.isExtreme).toBe(true);
      expect(extremeLow.zScore).toBeLessThan(-4.0);

      const extremeHigh = calculateLmsZScore(25.0, cdc9moBoyLms);
      expect(extremeHigh.isExtreme).toBe(true);
      expect(extremeHigh.zScore).toBeGreaterThan(4.0);
    });

    it('handles invalid, NaN, or non-positive inputs safely without crashing (Safety Bias)', () => {
      const invalidLms: LmsParams = { l: 1, m: 0, s: 0 };
      const res = calculateLmsZScore(0, invalidLms);
      expect(res.zScore).toBe(0);
      expect(res.isExtreme).toBe(true);
      expect(res.isImplausible).toBe(true);

      const nanRes = calculateLmsZScore(NaN, { l: 1, m: 10, s: 0.1 });
      expect(nanRes.isImplausible).toBe(true);

      const valNan = calculateLmsValue(NaN, { l: 1, m: 10, s: 0.1 });
      expect(valNan).toBe(0);
    });

    it('zScoreToPercentile handles NaN and out-of-bounds gracefully', () => {
      expect(zScoreToPercentile(NaN)).toBe(50.0);
      expect(zScoreToPercentile(10)).toBe(99.9);
      expect(zScoreToPercentile(-10)).toBe(0.1);
    });
  });

  describe('Mid-Parental Height Calculation & Bounds Guarding', () => {
    it('calculates mid-parental height for boy: (Father + Mother + 13) / 2', () => {
      const target = calculateMidParentalHeight('MALE', 175, 163);
      expect(target).not.toBeNull();
      expect(target?.targetHeightCm).toBe(175.5);
      expect(target?.targetHeightRangeLowCm).toBe(170.5);
      expect(target?.targetHeightRangeHighCm).toBe(180.5);
    });

    it('calculates mid-parental height for girl: (Father + Mother - 13) / 2', () => {
      const target = calculateMidParentalHeight('FEMALE', 175, 163);
      expect(target).not.toBeNull();
      expect(target?.targetHeightCm).toBe(162.5);
      expect(target?.targetHeightRangeLowCm).toBe(157.5);
      expect(target?.targetHeightRangeHighCm).toBe(167.5);
    });

    it('returns null if parental height is missing, NaN, or biologically implausible', () => {
      expect(calculateMidParentalHeight('MALE', undefined, 160)).toBeNull();
      expect(calculateMidParentalHeight('FEMALE', 175, null)).toBeNull();
      expect(calculateMidParentalHeight('MALE', NaN, 160)).toBeNull();
      expect(calculateMidParentalHeight('MALE', 50, 160)).toBeNull(); // < 80cm
      expect(calculateMidParentalHeight('MALE', 290, 160)).toBeNull(); // > 250cm
    });
  });

  describe('Percentile Channel Crossing Detection', () => {
    it('detects downward crossing of 2+ channels as Growth Faltering (PRIORITY / EMERGENCY)', () => {
      // 55th percentile drops to 8th percentile -> crosses 50th, 25th, 10th (3 channels)
      const res = detectPercentileCrossing(55, 8);
      expect(res.crossed).toBe(true);
      expect(res.direction).toBe('DOWNWARD');
      expect(res.channelsCrossed).toBeGreaterThanOrEqual(2);
      expect(res.severity).toBe('PRIORITY');
      expect(res.clinicalFlag).toContain('Growth Faltering');
    });

    it('detects severe drop below 3rd percentile as EMERGENCY', () => {
      // 50th percentile drops to 1.5 percentile -> crosses 50, 25, 10, 5, 3 (5 channels)
      const res = detectPercentileCrossing(50, 1.5);
      expect(res.crossed).toBe(true);
      expect(res.direction).toBe('DOWNWARD');
      expect(res.severity).toBe('EMERGENCY');
    });

    it('detects rapid upward crossing of 2+ channels', () => {
      // 15th percentile rises to 80th percentile -> crosses 25, 50, 75 (3 channels)
      const res = detectPercentileCrossing(15, 80);
      expect(res.crossed).toBe(true);
      expect(res.direction).toBe('UPWARD');
      expect(res.severity).toBe('PRIORITY');
    });

    it('does not trigger on normal stable percentile trends (crossing < 2 channels)', () => {
      const res = detectPercentileCrossing(52, 48);
      expect(res.crossed).toBe(false);
      expect(res.severity).toBe('NORMAL');
    });
  });

  describe('Clinical Growth Flags & Severity', () => {
    it('flags severe underweight (z < -3) as EMERGENCY', () => {
      const flag = evaluateGrowthFlag('WEIGHT_FOR_AGE', -3.2, 0.1);
      expect(flag.severity).toBe('EMERGENCY');
      expect(flag.clinicalFlag).toContain('Severe Underweight');
    });

    it('flags severe microcephaly (z < -3) as EMERGENCY', () => {
      const flag = evaluateGrowthFlag('HEAD_CIRCUMFERENCE_FOR_AGE', -3.5, 0.05);
      expect(flag.severity).toBe('EMERGENCY');
      expect(flag.clinicalFlag).toContain('Severe Microcephaly');
    });

    it('flags moderate microcephaly (z < -2 or < 3rd percentile) as PRIORITY', () => {
      const flag = evaluateGrowthFlag('HEAD_CIRCUMFERENCE_FOR_AGE', -2.2, 1.4);
      expect(flag.severity).toBe('PRIORITY');
      expect(flag.clinicalFlag).toContain('Microcephaly');
    });

    it('flags macrocephaly (> 97th percentile) as PRIORITY', () => {
      const flag = evaluateGrowthFlag('HEAD_CIRCUMFERENCE_FOR_AGE', 2.3, 98.9);
      expect(flag.severity).toBe('PRIORITY');
      expect(flag.clinicalFlag).toContain('Macrocephaly');
    });

    it('flags stunting (z < -2) as PRIORITY and severe stunting as EMERGENCY', () => {
      const moderate = evaluateGrowthFlag('LENGTH_FOR_AGE', -2.3, 1.1);
      expect(moderate.severity).toBe('PRIORITY');

      const severe = evaluateGrowthFlag('LENGTH_FOR_AGE', -3.1, 0.1);
      expect(severe.severity).toBe('EMERGENCY');
    });

    it('flags BMI obesity (>= 95th percentile) as PRIORITY', () => {
      const flag = evaluateGrowthFlag('BMI_FOR_AGE', 2.1, 98.2);
      expect(flag.severity).toBe('PRIORITY');
      expect(flag.clinicalFlag).toContain('Obesity');
    });

    it('handles NaN/invalid inputs with safety bias (PRIORITY flag)', () => {
      const flag = evaluateGrowthFlag('WEIGHT_FOR_AGE', NaN, NaN);
      expect(flag.severity).toBe('PRIORITY');
      expect(flag.clinicalFlag).toContain('Implausible');
    });

    it('marks normal growth as NORMAL', () => {
      const flag = evaluateGrowthFlag('WEIGHT_FOR_AGE', 0.2, 58.0);
      expect(flag.severity).toBe('NORMAL');
      expect(flag.clinicalFlag).toBeUndefined();
    });
  });
});
