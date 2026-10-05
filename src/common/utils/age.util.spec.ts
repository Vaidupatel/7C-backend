import { calculateAge, getHospitalDayBoundaries } from './age.util.js';

describe('calculateAge (Pure Logic)', () => {
  it('calculates age for a newborn on the same day as birth', () => {
    const dob = new Date('2026-10-04');
    const ref = new Date('2026-10-04');
    const result = calculateAge(dob, ref);

    expect(result.years).toBe(0);
    expect(result.months).toBe(0);
    expect(result.days).toBe(0);
    expect(result.totalDays).toBe(0);
    expect(result.formattedAge).toBe('0 days');
  });

  it('calculates age for a 15-day-old infant', () => {
    const dob = new Date('2026-09-19');
    const ref = new Date('2026-10-04');
    const result = calculateAge(dob, ref);

    expect(result.years).toBe(0);
    expect(result.months).toBe(0);
    expect(result.days).toBe(15);
    expect(result.formattedAge).toBe('15 days');
  });

  it('calculates age accurately across leap day (Feb 29, 2024 to Feb 28, 2025)', () => {
    const dob = new Date('2024-02-29');
    const ref = new Date('2025-02-28');
    const result = calculateAge(dob, ref);

    expect(result.years).toBe(0);
    expect(result.months).toBe(11);
    expect(result.days).toBe(30);
    expect(result.totalDays).toBe(365);
  });

  it('calculates age across month-end boundary (Jan 31 to Feb 28)', () => {
    const dob = new Date('2025-01-31');
    const ref = new Date('2025-02-28');
    const result = calculateAge(dob, ref);

    expect(result.years).toBe(0);
    expect(result.totalDays).toBe(28);
    expect(result.formattedAge).toBe('28 days');
  });

  it('calculates age for a child over 2 years old', () => {
    const dob = new Date('2023-04-15');
    const ref = new Date('2026-10-04');
    const result = calculateAge(dob, ref);

    expect(result.years).toBe(3);
    expect(result.months).toBe(5);
    expect(result.days).toBe(19);
    expect(result.formattedAge).toBe('3 yrs 5 mos');
  });

  it('applies gestational age correction for preterm infant (< 37 weeks)', () => {
    // Born 32 weeks (8 weeks preterm)
    const dob = new Date('2026-04-04');
    const ref = new Date('2026-10-04'); // Chronological age ~ 6.0 months
    const result = calculateAge(dob, ref, 32);

    expect(result.isPreterm).toBe(true);
    expect(result.totalMonths).toBeGreaterThan(5.9);
    // 8 weeks correction is approx 1.84 months
    expect(result.correctedAgeMonths).toBeLessThan(result.totalMonths);
    expect(result.correctedAgeMonths).toBeCloseTo(4.2, 0.5);
  });

  it('does not apply preterm correction past 24 months of age', () => {
    const dob = new Date('2023-01-01');
    const ref = new Date('2026-01-01'); // 36 months old
    const result = calculateAge(dob, ref, 30);

    expect(result.isPreterm).toBe(true);
    expect(result.correctedAgeMonths).toBe(result.totalMonths);
  });

  it('throws an error if Date of Birth is in the future', () => {
    const dob = new Date('2026-10-05');
    const ref = new Date('2026-10-04');

    expect(() => calculateAge(dob, ref)).toThrow(
      'Date of Birth cannot be in the future',
    );
  });

  describe('getHospitalDayBoundaries (Finding C9)', () => {
    it('correctly calculates boundaries across midnight IST before UTC rollover', () => {
      // 2026-10-04T19:00:00Z is 2026-10-05 00:30:00 IST
      const date = new Date('2026-10-04T19:00:00Z');
      const boundaries = getHospitalDayBoundaries(date);

      expect(boundaries.dateStr).toBe('2026-10-05');
      expect(boundaries.year).toBe(2026);
      expect(boundaries.month).toBe(10);
      expect(boundaries.day).toBe(5);
      expect(boundaries.startOfDay.toISOString()).toBe(
        '2026-10-04T18:30:00.000Z',
      );
      expect(boundaries.endOfDay.toISOString()).toBe(
        '2026-10-05T18:29:59.999Z',
      );
    });

    it('correctly calculates boundaries before midnight IST', () => {
      // 2026-10-04T18:00:00Z is 2026-10-04 23:30:00 IST
      const date = new Date('2026-10-04T18:00:00Z');
      const boundaries = getHospitalDayBoundaries(date);

      expect(boundaries.dateStr).toBe('2026-10-04');
      expect(boundaries.year).toBe(2026);
      expect(boundaries.month).toBe(10);
      expect(boundaries.day).toBe(4);
      expect(boundaries.startOfDay.toISOString()).toBe(
        '2026-10-03T18:30:00.000Z',
      );
      expect(boundaries.endOfDay.toISOString()).toBe(
        '2026-10-04T18:29:59.999Z',
      );
    });
  });
});
