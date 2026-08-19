/**
 * Budget periods. A period runs from monthStartDay of one month to the day
 * before monthStartDay of the next month, both ends inclusive.
 */
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  isAfter,
  parseISO,
  setDate,
  startOfDay,
} from "date-fns";
import type { Locale } from "./types.ts";

export type Period = {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
};

/** Local calendar date as "yyyy-MM-dd", never a UTC timestamp. */
export function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromIso(iso: string): Date {
  return startOfDay(parseISO(iso));
}

export function today(): string {
  return isoDate(new Date());
}

function buildPeriod(start: Date): Period {
  const end = addDays(addMonths(start, 1), -1);
  return { start, end, startIso: isoDate(start), endIso: isoDate(end) };
}

/** The period containing the given date, given the configured start day. */
export function periodFor(date: Date, monthStartDay: number): Period {
  const day = Math.min(Math.max(Math.trunc(monthStartDay), 1), 28);
  const candidate = startOfDay(setDate(date, day));
  const start = isAfter(candidate, startOfDay(date)) ? addMonths(candidate, -1) : candidate;
  return buildPeriod(start);
}

export function currentPeriod(monthStartDay: number, now: Date = new Date()): Period {
  return periodFor(now, monthStartDay);
}

/** Moves the period by whole months, negative for earlier periods. */
export function shiftPeriod(period: Period, months: number): Period {
  return buildPeriod(addMonths(period.start, months));
}

export function periodContains(period: Period, iso: string): boolean {
  return iso >= period.startIso && iso <= period.endIso;
}

export function daysInPeriod(period: Period): number {
  return differenceInCalendarDays(period.end, period.start) + 1;
}

/**
 * Days left in the period counting today, at least 1 so the per day figure
 * stays defined on the final day.
 */
export function daysRemaining(period: Period, now: Date = new Date()): number {
  const reference = startOfDay(now);
  if (isAfter(period.start, reference)) return daysInPeriod(period);
  const remaining = differenceInCalendarDays(period.end, reference) + 1;
  return Math.max(1, Math.min(remaining, daysInPeriod(period)));
}

export function isCurrentPeriod(period: Period, now: Date = new Date()): boolean {
  return periodContains(period, isoDate(now));
}

const rangeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions, key: string) {
  const cacheKey = `${locale}:${key}`;
  let formatter = rangeFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    rangeFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/** For example "1. August 2025 bis 31. August 2025". */
export function formatPeriodRange(period: Period, locale: Locale): string {
  const formatter = dateFormatter(
    locale,
    { day: "numeric", month: "long", year: "numeric" },
    "range",
  );
  return formatter.formatRange(period.start, period.end);
}

export function formatDayHeading(iso: string, locale: Locale): string {
  return dateFormatter(
    locale,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    "day",
  ).format(fromIso(iso));
}

export function formatShortDate(iso: string, locale: Locale): string {
  return dateFormatter(locale, { day: "2-digit", month: "2-digit", year: "numeric" }, "short").format(
    fromIso(iso),
  );
}

export function formatMonthLabel(period: Period, locale: Locale): string {
  return dateFormatter(locale, { month: "long", year: "numeric" }, "month").format(period.start);
}
