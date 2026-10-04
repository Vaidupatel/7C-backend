/**
 * Pure clinical age calculation utility (Pure function with no I/O).
 * Computes exact chronological age and gestational corrected age.
 */

export interface AgeResult {
  totalDays: number;
  totalMonths: number;
  years: number;
  months: number;
  days: number;
  isPreterm: boolean;
  correctedAgeMonths: number;
  formattedAge: string;
}

export function calculateAge(
  dobInput: Date | string,
  referenceDateInput: Date | string = new Date(),
  gestationalAgeWeeks: number = 40,
): AgeResult {
  const dob = typeof dobInput === 'string' ? new Date(dobInput) : dobInput;
  const refDate =
    typeof referenceDateInput === 'string'
      ? new Date(referenceDateInput)
      : referenceDateInput;

  if (isNaN(dob.getTime())) {
    throw new Error('Invalid Date of Birth provided');
  }
  if (isNaN(refDate.getTime())) {
    throw new Error('Invalid Reference Date provided');
  }
  if (dob > refDate) {
    throw new Error(
      'Date of Birth cannot be in the future relative to the reference date',
    );
  }

  const birthYear = dob.getFullYear();
  const birthMonth = dob.getMonth();
  const birthDay = dob.getDate();

  const refYear = refDate.getFullYear();
  const refMonth = refDate.getMonth();
  const refDay = refDate.getDate();

  let years = refYear - birthYear;
  let months = refMonth - birthMonth;
  let days = refDay - birthDay;

  if (days < 0) {
    months -= 1;
    // Get total days in previous month
    const prevMonthDays = new Date(refYear, refMonth, 0).getDate();
    days += prevMonthDays;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.floor(
    (Date.UTC(refYear, refMonth, refDay) -
      Date.UTC(birthYear, birthMonth, birthDay)) /
      msPerDay,
  );

  // Exact decimal months (average 30.4375 days per month)
  const totalMonths = totalDays / 30.4375;

  // Preterm Correction: Standard pediatric rule applies if born < 37 weeks
  // Corrected age (months) = Chronological age (months) - (40 - gestationalAgeWeeks) * (7 / 30.4375)
  const isPreterm = gestationalAgeWeeks < 37;
  let correctedAgeMonths = totalMonths;

  if (isPreterm && totalMonths <= 24) {
    const weeksPreterm = Math.max(0, 40 - gestationalAgeWeeks);
    const correctionMonths = (weeksPreterm * 7) / 30.4375;
    correctedAgeMonths = Math.max(0, totalMonths - correctionMonths);
  }

  // Clinical age formatting:
  // Under 1 month: "X days"
  // Under 2 years: "X months Y days"
  // 2 years and above: "X yrs Y mos"
  let formattedAge = '';
  if (years === 0 && months === 0) {
    formattedAge = `${days} day${days === 1 ? '' : 's'}`;
  } else if (years < 2) {
    const totalMos = years * 12 + months;
    formattedAge = `${totalMos} mo${totalMos === 1 ? '' : 's'} ${days} d`;
  } else {
    formattedAge = `${years} yr${years === 1 ? '' : 's'} ${months} mo${months === 1 ? '' : 's'}`;
  }

  return {
    totalDays,
    totalMonths: Math.round(totalMonths * 100) / 100,
    years,
    months,
    days,
    isPreterm,
    correctedAgeMonths: Math.round(correctedAgeMonths * 100) / 100,
    formattedAge,
  };
}
