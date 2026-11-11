import { z } from 'zod';

export const DATE_QUALIFIERS = ['exact', 'about', 'before', 'after', 'between'] as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[number];
export const DATE_PRECISIONS = ['day', 'month', 'year'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number?, number?];
  if (month === undefined) return true;
  if (month < 1 || month > 12) return false;
  if (day === undefined) return true;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0); // day 0 of next month = last day of `month`
  return day >= 1 && day <= lastDay.getUTCDate();
}

const partialDate = z
  .string()
  .regex(PARTIAL_DATE, 'Use YYYY, YYYY-MM or YYYY-MM-DD')
  .refine(isRealCalendarDate, 'Not a real calendar date');

export const fuzzyDateSchema = z
  .object({
    qualifier: z.enum(DATE_QUALIFIERS),
    date1: partialDate,
    date2: partialDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.qualifier === 'between') {
      if (value.date2 === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['date2'],
          message: 'date2 is required for "between"',
        });
      } else if (value.date2 < value.date1.slice(0, value.date2.length)) {
        // Compare at date2's precision: '1950-06'..'1950' is valid (1950 runs to December).
        ctx.addIssue({
          code: 'custom',
          path: ['date2'],
          message: 'date2 must not be before date1',
        });
      }
    } else if (value.date2 !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['date2'],
        message: 'date2 is only allowed for "between"',
      });
    }
  });

export type FuzzyDate = z.infer<typeof fuzzyDateSchema>;

export const FUTURE_DATE_MESSAGE = 'That date is in the future';

/** Today's date as YYYY-MM-DD where the calendar is furthest ahead (UTC+14), so a date that is
 *  today in the user's own time zone is never "in the future" here. */
const latestToday = (now: Date) => new Date(now.getTime() + 14 * 3_600_000).toISOString();

/** True when date1 (or date2) is after today, compared at that date's own precision. */
export function isFutureDate(d: FuzzyDate, now = new Date()): boolean {
  const today = latestToday(now);
  return [d.date1, d.date2].some((s) => s !== undefined && s > today.slice(0, s.length));
}

/** A fuzzy date that has happened: for birth and death dates. */
export const pastFuzzyDateSchema = fuzzyDateSchema.refine((d) => !isFutureDate(d), {
  message: FUTURE_DATE_MESSAGE,
});

/** Assumes `partial` has already been validated by `fuzzyDateSchema`. */
export function precisionOf(partial: string): DatePrecision {
  if (partial.length === 4) return 'year';
  if (partial.length === 7) return 'month';
  return 'day';
}

/** Year used for indexing, sorting and range filters (`*_sort_year` columns). */
export function sortYear(date: FuzzyDate): number {
  return Number(date.date1.slice(0, 4));
}
