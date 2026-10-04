import { calculateTriage, TriageInput } from './triage.util.js';

describe('triage.util', () => {
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
  });

  it('escalates to EMERGENCY if any emergency sign is present', () => {
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
      result.reasons.some((r) => r.includes('Stridor in calm child')),
    ).toBe(true);
  });

  it('escalates to PRIORITY if abnormal vital is present without emergency flags', () => {
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
  });

  it('escalates ROUTINE to PRIORITY when waiting time exceeds 60 minutes', () => {
    const input: TriageInput = {
      vitalsSeverity: 'NORMAL',
      vitalsReasons: [],
      signs: [{ name: 'Runny nose', redFlagLevel: 'NONE' }],
      waitingMinutes: 65,
    };
    const result = calculateTriage(input);
    expect(result.level).toBe('PRIORITY');
    expect(
      result.reasons.some((r) => r.includes('Waiting time escalation')),
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
});
