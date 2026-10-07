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

export const HOSPITAL_TIMEZONE = 'Asia/Kolkata';

export function getZonedDateParts(
  date: Date,
  timeZone: string = HOSPITAL_TIMEZONE,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10) - 1; // 0-indexed like Date.getMonth()
    if (part.type === 'day') day = parseInt(part.value, 10);
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'second') second = parseInt(part.value, 10);
  }
  return { year, month, day, hour, minute, second };
}

/**
 * Returns UTC start and end boundaries for a given calendar day in the hospital timezone (IST).
 * Also returns the Date object for Postgres @db.Date column and the YYYY-MM-DD string.
 */
export function getHospitalDayBoundaries(
  dateInput: Date | string = new Date(),
  timeZone: string = HOSPITAL_TIMEZONE,
) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const parts = getZonedDateParts(date, timeZone);

  // IST offset is UTC+5:30 (+330 minutes)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const midnightIstUtcMs =
    Date.UTC(parts.year, parts.month, parts.day, 0, 0, 0, 0) - istOffsetMs;
  const startOfDay = new Date(midnightIstUtcMs);
  const endOfDay = new Date(midnightIstUtcMs + 24 * 60 * 60 * 1000 - 1);

  // visitDay represents calendar date (stored in @db.Date column in Postgres)
  const visitDay = new Date(Date.UTC(parts.year, parts.month, parts.day));
  const monthStr = String(parts.month + 1).padStart(2, '0');
  const dayStr = String(parts.day).padStart(2, '0');
  const dateStr = `${parts.year}-${monthStr}-${dayStr}`;

  return {
    startOfDay,
    endOfDay,
    visitDay,
    dateStr,
    year: parts.year,
    month: parts.month + 1,
    day: parts.day,
  };
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

  // C9: Use hospital timezone (Asia/Kolkata) for calendar boundaries
  const birth = getZonedDateParts(dob, HOSPITAL_TIMEZONE);
  const ref = getZonedDateParts(refDate, HOSPITAL_TIMEZONE);

  const birthUtc = Date.UTC(birth.year, birth.month, birth.day);
  const refUtc = Date.UTC(ref.year, ref.month, ref.day);

  if (
    birthUtc > refUtc ||
    (birthUtc === refUtc && dob.getTime() > refDate.getTime())
  ) {
    throw new Error(
      'Date of Birth cannot be in the future relative to the reference date',
    );
  }

  const birthYear = birth.year;
  const birthMonth = birth.month;
  const birthDay = birth.day;

  const refYear = ref.year;
  const refMonth = ref.month;
  const refDay = ref.day;

  let years = refYear - birthYear;
  let months = refMonth - birthMonth;
  let days = refDay - birthDay;

  if (days < 0) {
    months -= 1;
    // Get total days in previous month using UTC to avoid DST shifts
    const prevMonthDays = new Date(Date.UTC(refYear, refMonth, 0)).getUTCDate();
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

/**
 * Safe age calculation wrapper that catches invalid or future dates
 * and returns a fallback AgeResult instead of throwing.
 * Use for read/query projections where invalid data should not crash the endpoint.
 */
export function safeCalculateAge(
  dobInput: Date | string,
  referenceDateInput: Date | string = new Date(),
  gestationalAgeWeeks: number = 40,
): AgeResult {
  try {
    return calculateAge(dobInput, referenceDateInput, gestationalAgeWeeks);
  } catch {
    return {
      totalDays: 0,
      totalMonths: 0,
      years: 0,
      months: 0,
      days: 0,
      isPreterm: false,
      correctedAgeMonths: 0,
      formattedAge: 'Unknown (invalid DOB)',
    };
  }
}
