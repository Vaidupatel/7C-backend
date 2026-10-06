import { calculateTriage, TriageInput } from './triage.util.js';

describe('triage.util (F7)', () => {
  it('returns ROUTINE when all vitals, signs, and growth are normal', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [{ name: 'Cough', redFlagLevel: 'NONE' }],
      waitingMinutes: 10,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('ROUTINE');
    expect(result.score).toBeGreaterThanOrEqual(1000);
    expect(result.score).toBeLessThan(2000);
    expect(result.reasons).toEqual([]);
  });

  it('escalates to EMERGENCY if any emergency sign is present and sets source=SIGNS', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [
        { name: 'Cough', redFlagLevel: 'NONE' },
        { name: 'Stridor in calm child', redFlagLevel: 'EMERGENCY' },
      ],
      waitingMinutes: 5,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('EMERGENCY');
    expect(result.score).toBeGreaterThanOrEqual(3000);
    expect(
      result.reasons.some(
        (r) =>
          r.label.includes('Stridor in calm child') &&
          r.source === 'SIGNS' &&
          r.severity === 'EMERGENCY',
      ),
    ).toBe(true);
  });

  it('escalates to PRIORITY if abnormal vital is present without emergency flags and sets source=VITALS', () => {
    const input: TriageInput = {
      vitalsSeverity: 'MODERATE',
      vitalsReasons: ['Tachycardia (160 bpm)'],
      signs: [{ name: 'Fever', redFlagLevel: 'NONE' }],
      waitingMinutes: 15,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('PRIORITY');
    expect(result.score).toBeGreaterThanOrEqual(2000);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].source).toBe('VITALS');
    expect(result.reasons[0].severity).toBe('PRIORITY');
  });

  it('sets source=GROWTH for growth alerts and severe growth flags', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [],
      growthFlags: [
        { severity: 'EMERGENCY', label: 'Severe Wasting (Z < -3)' },
        { severity: 'PRIORITY', label: 'Stunting (< 5th %ile)' },
      ],
      waitingMinutes: 10,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('EMERGENCY');
    expect(result.score).toBeGreaterThanOrEqual(3000);

    const growthReasons = result.reasons.filter((r) => r.source === 'GROWTH');
    expect(growthReasons).toHaveLength(2);
    expect(growthReasons[0].severity).toBe('EMERGENCY');
    expect(growthReasons[1].severity).toBe('PRIORITY');
  });

  it('highest component wins: critical vitals override priority sign to EMERGENCY', () => {
    const input: TriageInput = {
      vitalsSeverity: 'CRITICAL',
      vitalsReasons: ['Severe hypoxemia (SpO2 86%)'],
      signs: [{ name: 'Chest indrawing', redFlagLevel: 'PRIORITY' }],
      waitingMinutes: 5,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('EMERGENCY');
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons.some((r) => r.source === 'VITALS')).toBe(true);
    expect(result.reasons.some((r) => r.source === 'SIGNS')).toBe(true);
  });

  it('escalates ROUTINE to PRIORITY when waiting time exceeds 60 minutes with source=WAIT_TIME', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [{ name: 'Runny nose', redFlagLevel: 'NONE' }],
      waitingMinutes: 65,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('PRIORITY');
    expect(
      result.reasons.some(
        (r) =>
          r.label.includes('Waiting time escalation') &&
          r.source === 'WAIT_TIME',
      ),
    ).toBe(true);
  });

  it('reasons list is never empty above ROUTINE', () => {
    const input: TriageInput = {
      vitalsSeverity: 'MODERATE',
      vitalsReasons: ['Mild tachypnea'],
      signs: [],
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('PRIORITY');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('applies safety bias: missing vital data warnings escalate ROUTINE to PRIORITY', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [{ name: 'Cough', redFlagLevel: 'NONE' }],
      waitingMinutes: 10,
      missingDataWarnings: ['SpO2 not recorded'],
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('PRIORITY');
    expect(result.score).toBeGreaterThanOrEqual(2000);
    expect(
      result.reasons.some(
        (r) =>
          r.label.includes('Safety bias escalation') && r.source === 'WARNING',
      ),
    ).toBe(true);
    expect(
      result.reasons.some(
        (r) =>
          r.label.includes('Missing data warning: SpO2 not recorded') &&
          r.source === 'WARNING',
      ),
    ).toBe(true);
  });
});
