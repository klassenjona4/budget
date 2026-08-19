/**
 * Balance maths. The balance is a ledger: an opening figure the user sets,
 * moved by every transaction dated on or after the opening date. There is no
 * bank connection, so a correction entry is how the ledger is brought back in
 * line with the real account.
 */
import { addDays, isoDate } from "./period.ts";
import type { Settings, Transaction } from "./types.ts";

export type BalancePoint = {
  date: string;
  balanceCents: number;
};

/** Transactions that count towards the balance, oldest first. */
function ledgerRows(settings: Settings, transactions: Transaction[]): Transaction[] {
  return transactions
    .filter((row) => row.date >= settings.openingBalanceDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Balance at the end of the given day. */
export function balanceAt(
  settings: Settings,
  transactions: Transaction[],
  iso: string,
): number {
  let total = settings.openingBalanceCents;
  for (const row of ledgerRows(settings, transactions)) {
    if (row.date > iso) break;
    total += row.amountCents;
  }
  return total;
}

export function currentBalance(
  settings: Settings,
  transactions: Transaction[],
  today: string,
): number {
  return balanceAt(settings, transactions, today);
}

/**
 * Closing balance for each of the last `days` days, oldest first, so the
 * series can be drawn straight onto a chart.
 */
export function balanceSeries(
  settings: Settings,
  transactions: Transaction[],
  days: number,
  endIso: string,
): BalancePoint[] {
  const rows = ledgerRows(settings, transactions);
  const startIso = isoDate(addDays(new Date(`${endIso}T00:00:00`), -(days - 1)));

  // Everything before the window is folded into the starting figure.
  let running = settings.openingBalanceCents;
  let index = 0;
  while (index < rows.length && (rows[index]?.date ?? "") < startIso) {
    running += rows[index]?.amountCents ?? 0;
    index += 1;
  }

  const points: BalancePoint[] = [];
  let cursor = new Date(`${startIso}T00:00:00`);
  for (let day = 0; day < days; day++) {
    const iso = isoDate(cursor);
    while (index < rows.length && (rows[index]?.date ?? "") <= iso) {
      running += rows[index]?.amountCents ?? 0;
      index += 1;
    }
    points.push({ date: iso, balanceCents: running });
    cursor = addDays(cursor, 1);
  }
  return points;
}

/** Change across the series, used for the headline under the graph. */
export function seriesChange(points: BalancePoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  return last.balanceCents - first.balanceCents;
}
