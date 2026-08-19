/**
 * Recurring payments. A recurrence is a template, not a transaction. Due
 * dates are worked out on unlock and posted as normal transactions carrying
 * the recurrence id, so they can be edited or deleted like anything else.
 */
import { addDays, addMonths, addYears, isoDate, fromIso } from "./period.ts";
import type { Recurrence, Transaction } from "./types.ts";

const MAX_POSTS = 400; // a guard against a runaway loop on a bad record

function clampDay(day: number): number {
  return Math.min(Math.max(Math.trunc(day), 1), 28);
}

/** Every date the recurrence falls due within the inclusive window. */
export function dueDates(recurrence: Recurrence, fromIsoDate: string, toIsoDate: string): string[] {
  const lower = fromIsoDate > recurrence.startDate ? fromIsoDate : recurrence.startDate;
  const upper =
    recurrence.endDate && recurrence.endDate < toIsoDate ? recurrence.endDate : toIsoDate;
  if (lower > upper) return [];

  const dates: string[] = [];
  let cursor: Date;

  if (recurrence.interval === "weekly") {
    cursor = fromIso(lower);
    const target = ((Math.trunc(recurrence.weekday) % 7) + 7) % 7;
    while (cursor.getDay() !== target) cursor = addDays(cursor, 1);
  } else if (recurrence.interval === "monthly") {
    const start = fromIso(lower);
    cursor = new Date(start.getFullYear(), start.getMonth(), clampDay(recurrence.dayOfMonth));
    if (isoDate(cursor) < lower) cursor = addMonths(cursor, 1);
  } else {
    const start = fromIso(lower);
    const month = Math.min(Math.max(Math.trunc(recurrence.month), 1), 12) - 1;
    cursor = new Date(start.getFullYear(), month, clampDay(recurrence.dayOfMonth));
    if (isoDate(cursor) < lower) cursor = addYears(cursor, 1);
  }

  while (dates.length < MAX_POSTS) {
    const iso = isoDate(cursor);
    if (iso > upper) break;
    dates.push(iso);
    cursor =
      recurrence.interval === "weekly"
        ? addDays(cursor, 7)
        : recurrence.interval === "monthly"
          ? addMonths(cursor, 1)
          : addYears(cursor, 1);
  }
  return dates;
}

/** The next date the recurrence falls due, looking forward from a date. */
export function nextDueDate(recurrence: Recurrence, fromIsoDate: string): string | null {
  if (!recurrence.active) return null;
  const horizon = isoDate(addYears(fromIso(fromIsoDate), 1));
  return dueDates(recurrence, fromIsoDate, horizon)[0] ?? null;
}

export type PendingPost = {
  recurrence: Recurrence;
  dates: string[];
};

/**
 * Dates that are due but not yet posted, for every active recurrence.
 * Posting starts the day after lastPostedDate so a restart cannot duplicate.
 */
export function pendingPosts(recurrences: Recurrence[], todayIso: string): PendingPost[] {
  const pending: PendingPost[] = [];
  for (const recurrence of recurrences) {
    if (!recurrence.active) continue;
    const from = recurrence.lastPostedDate
      ? isoDate(addDays(fromIso(recurrence.lastPostedDate), 1))
      : recurrence.startDate;
    if (from > todayIso) continue;
    const dates = dueDates(recurrence, from, todayIso);
    if (dates.length > 0) pending.push({ recurrence, dates });
  }
  return pending;
}

export function describeInterval(recurrence: Recurrence): string {
  if (recurrence.interval === "weekly") {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `Weekly on ${names[((recurrence.weekday % 7) + 7) % 7] ?? "Monday"}`;
  }
  if (recurrence.interval === "monthly") {
    return `Monthly on day ${clampDay(recurrence.dayOfMonth)}`;
  }
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = months[Math.min(Math.max(recurrence.month, 1), 12) - 1] ?? "January";
  return `Yearly on ${clampDay(recurrence.dayOfMonth)} ${month}`;
}

/** Builds the transaction rows for a set of due dates. */
export function postsFor(
  recurrence: Recurrence,
  dates: string[],
  newId: () => string,
): Transaction[] {
  const createdAt = new Date().toISOString();
  return dates.map((date) => ({
    id: newId(),
    type: "transaction",
    date,
    amountCents: recurrence.amountCents,
    categoryId: recurrence.categoryId,
    note: recurrence.name,
    createdAt,
    recurrenceId: recurrence.id,
  }));
}
