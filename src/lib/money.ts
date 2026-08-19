/**
 * Money handling. Every amount is an integer number of cents.
 * No value ever passes through a floating point operation: the formatter is
 * given a decimal string, which Intl.NumberFormat accepts directly.
 */
import type { Locale } from "./types.ts";

/** Splits integer cents into a decimal string such as "-12.34". */
export function centsToDecimalString(cents: number): `${number}` {
  const negative = cents < 0;
  const abs = negative ? -cents : cents;
  const whole = (abs - (abs % 100)) / 100; // exact, abs is an integer
  const frac = abs % 100;
  const fracText = frac < 10 ? `0${frac}` : `${frac}`;
  return `${negative ? "-" : ""}${whole}.${fracText}` as `${number}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(locale: Locale, signDisplay: "auto" | "never" | "always"): Intl.NumberFormat {
  const key = `${locale}:${signDisplay}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Formats integer cents as EUR in the chosen locale, sign shown when negative. */
export function formatCents(cents: number, locale: Locale): string {
  return currencyFormatter(locale, "auto").format(centsToDecimalString(cents));
}

/** Formats the magnitude only, for figures whose direction is already clear. */
export function formatCentsAbs(cents: number, locale: Locale): string {
  return currencyFormatter(locale, "never").format(centsToDecimalString(cents));
}

/** Formats with an explicit plus or minus, used for income and for balances. */
export function formatCentsSigned(cents: number, locale: Locale): string {
  return currencyFormatter(locale, "always").format(centsToDecimalString(cents));
}

/** Plain machine readable form for CSV export: a dot decimal, no separators. */
export function formatCentsPlain(cents: number): string {
  return centsToDecimalString(cents);
}

/**
 * Turns a run of keypad digits into cents. "1234" is 12.34, capped so a
 * mistyped run cannot leave the safe integer range.
 */
export function digitsToCents(digits: string): number {
  const trimmed = digits.replace(/\D/g, "").slice(0, 9);
  if (trimmed === "") return 0;
  return Number.parseInt(trimmed, 10);
}

/** Display form of the amount being typed, without a currency symbol. */
export function formatDigits(digits: string, locale: Locale): string {
  const cents = digitsToCents(digits);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDecimalString(cents));
}

/** Parses "12.34" or "12,34" into integer cents. Returns null when malformed. */
export function parseDecimalToCents(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole = "0", frac = ""] = match;
  const padded = (frac + "00").slice(0, 2);
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(padded, 10);
  if (!Number.isSafeInteger(cents)) return null;
  return sign === "-" ? -cents : cents;
}

/**
 * Integer floor division, exact for safe integers. Used for per day figures
 * so that no intermediate value is a fraction.
 */
export function divFloor(value: number, divisor: number): number {
  if (divisor === 0) return 0;
  const remainder = ((value % divisor) + divisor) % divisor;
  return (value - remainder) / divisor;
}
