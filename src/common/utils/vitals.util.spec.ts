import { evaluateVitals, VitalInput } from './vitals.util.js';

describe('vitals.util', () => {
  it('identifies normal vitals for a 6-month-old infant', () => {
    const input: VitalInput = {
      ageMonths: 6,
      heartRateBpm: 120,
      respiratoryRateBpm: 35,
      spo2Percent: 98,
      temperatureC: 37.0,
      capillaryRefillSec: 1.5,
      avpu: 'ALERT',
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('NORMAL');
    expect(result.findings).toHaveLength(0);
    expect(result.hasMissingDataWarning).toBe(false);
  });

  it('flags severe hypoxemia (SpO2 88%) as CRITICAL', () => {
    const input: VitalInput = {
      ageMonths: 18,
      spo2Percent: 88,
      heartRateBpm: 110,
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('CRITICAL');
    expect(
      result.findings.some(
        (f) => f.vital === 'SpO2' && f.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  it('flags altered consciousness (AVPU = VOICE or UNRESPONSIVE) as CRITICAL', () => {
    const input: VitalInput = {
      ageMonths: 24,
      avpu: 'UNRESPONSIVE',
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('CRITICAL');
    expect(
      result.findings.some(
        (f) => f.vital === 'AVPU' && f.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  it('flags prolonged capillary refill (> 3.0s) as CRITICAL', () => {
    const input: VitalInput = {
      ageMonths: 12,
      capillaryRefillSec: 3.5,
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('CRITICAL');
  });

  it('flags severe tachycardia by age band as CRITICAL', () => {
    // 6-month-old infant: norm.hr.highCrit = 180
    const input: VitalInput = {
      ageMonths: 6,
      heartRateBpm: 195,
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('CRITICAL');
  });

  it('flags fever without critical findings as MODERATE or MILD', () => {
    const input: VitalInput = {
      ageMonths: 36,
      temperatureC: 38.4,
      heartRateBpm: 100,
      respiratoryRateBpm: 24,
      spo2Percent: 99,
      avpu: 'ALERT',
    };
    const result = evaluateVitals(input);
    expect(result.overallSeverity).toBe('MILD');
  });
});
