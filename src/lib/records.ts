/**
 * The encrypted record repository. Reads and writes go through here so that
 * no component has to think about ciphertext.
 */
import { decryptJson, encryptJson, newId } from "./crypto.ts";
import {
  clearRecords,
  deleteRecord,
  listRecords,
  putRecord,
  putRecords,
  type StoredRecord,
} from "./db.ts";
import { today } from "./period.ts";
import {
  CORRECTION_CATEGORY_NAME,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  PALETTE,
  SEED_CATEGORIES,
  type BudgetRecord,
  type Category,
  type Recurrence,
  type RecurrenceInterval,
  type Settings,
  type Transaction,
} from "./types.ts";

export type VaultData = {
  categories: Category[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  settings: Settings;
  /** Rows that failed to decrypt, which should always be zero. */
  damaged: number;
};

async function seal(dek: CryptoKey, record: BudgetRecord): Promise<StoredRecord> {
  const sealed = await encryptJson(dek, record);
  return { id: record.id, type: record.type, iv: sealed.iv, ct: sealed.ct };
}

export async function saveRecord(dek: CryptoKey, record: BudgetRecord): Promise<void> {
  await putRecord(await seal(dek, record));
}

export async function saveRecords(dek: CryptoKey, records: BudgetRecord[]): Promise<void> {
  await putRecords(await Promise.all(records.map((record) => seal(dek, record))));
}

export async function removeRecord(id: string): Promise<void> {
  await deleteRecord(id);
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name));
}

export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

export function sortRecurrences(recurrences: Recurrence[]): Recurrence[] {
  return [...recurrences].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
  );
}

/** Decrypts every row into memory. A few thousand rows is trivial. */
export async function loadAll(dek: CryptoKey): Promise<VaultData> {
  const rows = await listRecords();
  const categories: Category[] = [];
  const transactions: Transaction[] = [];
  const recurrences: Recurrence[] = [];
  let settings: Settings | null = null;
  let damaged = 0;

  for (const row of rows) {
    let record: BudgetRecord;
    try {
      record = await decryptJson<BudgetRecord>(dek, { iv: row.iv, ct: row.ct });
    } catch {
      damaged += 1;
      continue;
    }
    if (record.type === "category") categories.push(record);
    else if (record.type === "transaction") transactions.push(record);
    else if (record.type === "recurrence") recurrences.push(record);
    else settings = { ...DEFAULT_SETTINGS, ...record, notifications: { ...DEFAULT_NOTIFICATIONS, ...record.notifications } };
  }

  return {
    categories: sortCategories(categories),
    transactions: sortTransactions(transactions),
    recurrences: sortRecurrences(recurrences),
    settings: settings ?? DEFAULT_SETTINGS,
    damaged,
  };
}

function buildCategory(name: string, kind: Category["kind"], index: number): Category {
  return {
    id: newId(),
    type: "category",
    name,
    kind,
    colour: PALETTE[index % PALETTE.length] ?? PALETTE[0],
    archived: false,
    sortIndex: index,
  };
}

/** Creates the settings record and the seed categories on first setup. */
export async function seedInitialData(dek: CryptoKey): Promise<VaultData> {
  const categories: Category[] = SEED_CATEGORIES.map((seed, index) =>
    buildCategory(seed.name, seed.kind, index),
  );
  categories.push({
    ...buildCategory(CORRECTION_CATEGORY_NAME, "variable", SEED_CATEGORIES.length),
    colour: "#8A93B5",
    archived: true,
    system: "correction",
  });
  const settings: Settings = { ...DEFAULT_SETTINGS, openingBalanceDate: today() };
  await saveRecords(dek, [settings, ...categories]);
  return { categories, transactions: [], recurrences: [], settings, damaged: 0 };
}

/** The reserved category that balance corrections are booked against. */
export function correctionCategory(categories: Category[]): Category | null {
  return (
    categories.find((category) => category.system === "correction") ??
    categories.find((category) => category.name === CORRECTION_CATEGORY_NAME) ??
    null
  );
}

export async function replaceAll(dek: CryptoKey, records: BudgetRecord[]): Promise<void> {
  await clearRecords();
  await saveRecords(dek, records);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates one record coming from a backup file. Returns null when unusable. */
export function parseRecord(value: unknown): BudgetRecord | null {
  if (!isObject(value)) return null;
  const id = asString(value["id"]);
  const type = asString(value["type"]);
  if (!id || !type) return null;

  if (type === "category") {
    const name = asString(value["name"]);
    if (name === null) return null;
    const colour = asString(value["colour"]);
    const sortIndex = asInteger(value["sortIndex"]);
    const category: Category = {
      id,
      type: "category",
      name,
      kind: value["kind"] === "fixed" ? "fixed" : "variable",
      colour: colour && /^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : PALETTE[0],
      archived: value["archived"] === true,
      sortIndex: sortIndex ?? 0,
      ...(value["system"] === "correction" || name === CORRECTION_CATEGORY_NAME
        ? { system: "correction" as const }
        : {}),
    };
    return category;
  }

  if (type === "transaction") {
    const date = asString(value["date"]);
    const amountCents = asInteger(value["amountCents"]);
    const categoryId = asString(value["categoryId"]);
    const createdAt = asString(value["createdAt"]);
    const recurrenceId = asString(value["recurrenceId"]);
    if (!date || !ISO_DATE.test(date)) return null;
    if (amountCents === null || !categoryId) return null;
    const transaction: Transaction = {
      id,
      type: "transaction",
      date,
      amountCents,
      categoryId,
      note: asString(value["note"]) ?? "",
      createdAt: createdAt ?? new Date().toISOString(),
      ...(value["kind"] === "adjustment" ? { kind: "adjustment" as const } : {}),
      ...(recurrenceId ? { recurrenceId } : {}),
    };
    return transaction;
  }

  if (type === "recurrence") {
    const name = asString(value["name"]);
    const amountCents = asInteger(value["amountCents"]);
    const categoryId = asString(value["categoryId"]);
    const startDate = asString(value["startDate"]);
    const endDate = asString(value["endDate"]);
    const lastPostedDate = asString(value["lastPostedDate"]);
    const interval = value["interval"];
    if (!name || amountCents === null || !categoryId) return null;
    if (!startDate || !ISO_DATE.test(startDate)) return null;
    const recurrence: Recurrence = {
      id,
      type: "recurrence",
      name,
      amountCents,
      categoryId,
      interval:
        interval === "weekly" || interval === "yearly"
          ? (interval as RecurrenceInterval)
          : "monthly",
      dayOfMonth: clamp(asInteger(value["dayOfMonth"]) ?? 1, 1, 28),
      weekday: clamp(asInteger(value["weekday"]) ?? 1, 0, 6),
      month: clamp(asInteger(value["month"]) ?? 1, 1, 12),
      startDate,
      endDate: endDate && ISO_DATE.test(endDate) ? endDate : null,
      lastPostedDate: lastPostedDate && ISO_DATE.test(lastPostedDate) ? lastPostedDate : null,
      active: value["active"] !== false,
    };
    return recurrence;
  }

  if (type === "settings") {
    const notifications = isObject(value["notifications"]) ? value["notifications"] : {};
    const openingDate = asString(value["openingBalanceDate"]);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      locale: value["locale"] === "en-IE" ? "en-IE" : "de-DE",
      monthStartDay: clamp(asInteger(value["monthStartDay"]) ?? 1, 1, 28),
      autoLockSeconds: clamp(asInteger(value["autoLockSeconds"]) ?? 120, 30, 900),
      lockOnBackground: value["lockOnBackground"] !== false,
      wipeAfterFailures: value["wipeAfterFailures"] === true,
      lastExportAt: asString(value["lastExportAt"]),
      openingBalanceCents: asInteger(value["openingBalanceCents"]) ?? 0,
      openingBalanceDate:
        openingDate && ISO_DATE.test(openingDate) ? openingDate : DEFAULT_SETTINGS.openingBalanceDate,
      monthlyTargetCents: Math.max(0, asInteger(value["monthlyTargetCents"]) ?? 0),
      notifications: {
        enabled: notifications["enabled"] === true,
        morningHour: clamp(asInteger(notifications["morningHour"]) ?? 6, 0, 23),
        eveningHour: clamp(asInteger(notifications["eveningHour"]) ?? 21, 0, 23),
        paceAlerts: notifications["paceAlerts"] !== false,
      },
      lastMorningNotice: asString(value["lastMorningNotice"]),
      lastEveningNotice: asString(value["lastEveningNotice"]),
    };
    return settings;
  }

  return null;
}
