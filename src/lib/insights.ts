/**
 * Everything the review screen and the alerts are derived from.
 * All figures are integer cents.
 */
import { divFloor } from "./money.ts";
import {
  addDays,
  daysInPeriod,
  isoDate,
  fromIso,
  periodContains,
  type Period,
} from "./period.ts";
import type { Category, Settings, Transaction } from "./types.ts";

export type CategorySlice = {
  categoryId: string;
  name: string;
  colour: string;
  amountCents: number;
  /** Share of total spending in tenths of a percent, so it stays integer. */
  sharePerMille: number;
};

export type DayBar = {
  date: string;
  spentCents: number;
};

export type PaceStatus = "no-target" | "under" | "on" | "over";

export type MonthInsight = {
  period: Period;
  spentCents: number;
  receivedCents: number;
  netCents: number;
  transactionCount: number;
  byCategory: CategorySlice[];
  daily: DayBar[];
  busiestDay: DayBar | null;
  targetCents: number;
  /** What the target allows by this point in the month. */
  allowedSoFarCents: number;
  /** Spending extended over the whole month at the current rate. */
  projectedCents: number;
  status: PaceStatus;
  daysElapsed: number;
  daysTotal: number;
};

/** Spending excludes income and balance corrections. */
export function isSpending(row: Transaction): boolean {
  return row.kind !== "adjustment" && row.amountCents < 0;
}

function isIncome(row: Transaction): boolean {
  return row.kind !== "adjustment" && row.amountCents > 0;
}

export function summariseMonth(
  categories: Category[],
  transactions: Transaction[],
  period: Period,
  settings: Settings,
  now: Date = new Date(),
): MonthInsight {
  const rows = transactions.filter((row) => periodContains(period, row.date));
  const byId = new Map(categories.map((category) => [category.id, category]));

  let spentCents = 0;
  let receivedCents = 0;
  const perCategory = new Map<string, number>();
  const perDay = new Map<string, number>();

  for (const row of rows) {
    if (isSpending(row)) {
      const amount = -row.amountCents;
      spentCents += amount;
      perCategory.set(row.categoryId, (perCategory.get(row.categoryId) ?? 0) + amount);
      perDay.set(row.date, (perDay.get(row.date) ?? 0) + amount);
    } else if (isIncome(row)) {
      receivedCents += row.amountCents;
    }
  }

  const byCategory: CategorySlice[] = [...perCategory.entries()]
    .map(([categoryId, amountCents]) => {
      const category = byId.get(categoryId);
      return {
        categoryId,
        name: category?.name ?? "Unknown category",
        colour: category?.colour ?? "#8A93B5",
        amountCents,
        sharePerMille: spentCents > 0 ? divFloor(amountCents * 1000, spentCents) : 0,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);

  const daysTotal = daysInPeriod(period);
  const daily: DayBar[] = [];
  let cursor = period.start;
  for (let day = 0; day < daysTotal; day++) {
    const iso = isoDate(cursor);
    daily.push({ date: iso, spentCents: perDay.get(iso) ?? 0 });
    cursor = addDays(cursor, 1);
  }

  const busiestDay = daily.reduce<DayBar | null>(
    (best, bar) => (bar.spentCents > 0 && (!best || bar.spentCents > best.spentCents) ? bar : best),
    null,
  );

  const todayIso = isoDate(now);
  const daysElapsed =
    todayIso < period.startIso
      ? 0
      : todayIso > period.endIso
        ? daysTotal
        : daily.filter((bar) => bar.date <= todayIso).length;

  const targetCents = settings.monthlyTargetCents;
  const allowedSoFarCents = targetCents > 0 ? divFloor(targetCents * daysElapsed, daysTotal) : 0;
  const projectedCents = daysElapsed > 0 ? divFloor(spentCents * daysTotal, daysElapsed) : 0;

  let status: PaceStatus = "no-target";
  if (targetCents > 0 && daysElapsed > 0) {
    // A tenth of the target is the band that counts as on track.
    const band = divFloor(targetCents, 10);
    if (spentCents > allowedSoFarCents + band) status = "over";
    else if (spentCents < allowedSoFarCents - band) status = "under";
    else status = "on";
  }

  return {
    period,
    spentCents,
    receivedCents,
    netCents: receivedCents - spentCents,
    transactionCount: rows.length,
    byCategory,
    daily,
    busiestDay,
    targetCents,
    allowedSoFarCents,
    projectedCents,
    status,
    daysElapsed,
    daysTotal,
  };
}

/** Spending on one calendar day, used by the evening recap. */
export function spentOn(transactions: Transaction[], iso: string): number {
  return transactions
    .filter((row) => row.date === iso && isSpending(row))
    .reduce((sum, row) => sum + -row.amountCents, 0);
}

/** Mean daily spending over the days before today, for the starter card. */
export function averageDailySpend(
  transactions: Transaction[],
  days: number,
  todayIso: string,
): number {
  const from = isoDate(addDays(fromIso(todayIso), -days));
  const total = transactions
    .filter((row) => row.date >= from && row.date < todayIso && isSpending(row))
    .reduce((sum, row) => sum + -row.amountCents, 0);
  return divFloor(total, Math.max(1, days));
}

/** Rounded whole percent for display. The underlying value stays integer. */
export function sharePercent(sharePerMille: number): number {
  return Math.round(sharePerMille / 10);
}

/** Top slices with the tail folded into one entry, so a chart stays readable. */
export function topSlices(slices: CategorySlice[], limit: number): CategorySlice[] {
  if (slices.length <= limit) return slices;
  const head = slices.slice(0, limit);
  const tail = slices.slice(limit);
  const amountCents = tail.reduce((sum, slice) => sum + slice.amountCents, 0);
  const sharePerMille = tail.reduce((sum, slice) => sum + slice.sharePerMille, 0);
  return [
    ...head,
    {
      categoryId: "other-slices",
      name: `${tail.length} more`,
      colour: "#8A93B5",
      amountCents,
      sharePerMille,
    },
  ];
}

/** Category ids ordered by most recent use, for the add flow. */
export function recentCategoryIds(transactions: Transaction[], limit = 6): string[] {
  const seen: string[] = [];
  for (const row of transactions) {
    if (!seen.includes(row.categoryId)) seen.push(row.categoryId);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** Groups transactions by ISO date, newest day first, with a daily total. */
export function groupByDay(
  transactions: Transaction[],
): { date: string; totalCents: number; rows: Transaction[] }[] {
  const groups = new Map<string, Transaction[]>();
  for (const row of transactions) {
    const bucket = groups.get(row.date);
    if (bucket) bucket.push(row);
    else groups.set(row.date, [row]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => ({
      date,
      rows,
      totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    }));
}
