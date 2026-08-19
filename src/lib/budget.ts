/** Budget arithmetic. Every figure here is an integer number of cents. */
import { divFloor } from "./money.ts";
import { daysRemaining, periodContains, type Period } from "./period.ts";
import type { Category, Transaction } from "./types.ts";

export type CategorySummary = {
  category: Category;
  spentCents: number;
  plannedCents: number;
  remainingCents: number;
  transactionCount: number;
};

export type PeriodSummary = {
  plannedCents: number;
  spentCents: number;
  remainingCents: number;
  incomeCents: number;
  perDayCents: number;
  daysLeft: number;
  categories: CategorySummary[];
};

/**
 * Spending is the negated sum of the amounts in a category, so a refund
 * posted as income against the same category reduces the figure.
 */
export function summarise(
  categories: Category[],
  transactions: Transaction[],
  period: Period,
  now: Date = new Date(),
): PeriodSummary {
  const inPeriod = transactions.filter((row) => periodContains(period, row.date));

  const spentByCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  let incomeCents = 0;

  for (const row of inPeriod) {
    spentByCategory.set(row.categoryId, (spentByCategory.get(row.categoryId) ?? 0) - row.amountCents);
    countByCategory.set(row.categoryId, (countByCategory.get(row.categoryId) ?? 0) + 1);
    if (row.amountCents > 0) incomeCents += row.amountCents;
  }

  const summaries: CategorySummary[] = categories
    .filter((category) => !category.archived || (countByCategory.get(category.id) ?? 0) > 0)
    .map((category) => {
      const spentCents = spentByCategory.get(category.id) ?? 0;
      return {
        category,
        spentCents,
        plannedCents: category.monthlyPlanCents,
        remainingCents: category.monthlyPlanCents - spentCents,
        transactionCount: countByCategory.get(category.id) ?? 0,
      };
    });

  let plannedCents = 0;
  let spentCents = 0;
  let variablePlanned = 0;
  let variableSpent = 0;

  for (const summary of summaries) {
    if (!summary.category.archived) plannedCents += summary.plannedCents;
    spentCents += summary.spentCents;
    if (summary.category.kind === "variable" && !summary.category.archived) {
      variablePlanned += summary.plannedCents;
      variableSpent += summary.spentCents;
    }
  }

  const daysLeft = daysRemaining(period, now);

  return {
    plannedCents,
    spentCents,
    remainingCents: plannedCents - spentCents,
    incomeCents,
    perDayCents: divFloor(variablePlanned - variableSpent, daysLeft),
    daysLeft,
    categories: summaries,
  };
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
