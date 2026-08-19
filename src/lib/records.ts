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
import {
  DEFAULT_SETTINGS,
  PALETTE,
  SEED_CATEGORIES,
  type BudgetRecord,
  type Category,
  type Settings,
  type Transaction,
} from "./types.ts";

export type VaultData = {
  categories: Category[];
  transactions: Transaction[];
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
  return [...categories].sort(
    (a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name),
  );
}

export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Decrypts every row into memory. A few thousand rows is trivial. */
export async function loadAll(dek: CryptoKey): Promise<VaultData> {
  const rows = await listRecords();
  const categories: Category[] = [];
  const transactions: Transaction[] = [];
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
    else settings = { ...DEFAULT_SETTINGS, ...record };
  }

  return {
    categories: sortCategories(categories),
    transactions: sortTransactions(transactions),
    settings: settings ?? DEFAULT_SETTINGS,
    damaged,
  };
}

/** Creates the settings record and the seed categories on first setup. */
export async function seedInitialData(dek: CryptoKey): Promise<VaultData> {
  const categories: Category[] = SEED_CATEGORIES.map((seed, index) => ({
    id: newId(),
    type: "category",
    name: seed.name,
    kind: seed.kind,
    monthlyPlanCents: 0,
    colour: PALETTE[index % PALETTE.length] ?? PALETTE[0],
    archived: false,
    sortIndex: index,
  }));
  const settings: Settings = { ...DEFAULT_SETTINGS };
  await saveRecords(dek, [settings, ...categories]);
  return { categories, transactions: [], settings, damaged: 0 };
}

export async function replaceAll(dek: CryptoKey, records: BudgetRecord[]): Promise<void> {
  await clearRecords();
  await saveRecords(dek, records);
}

/** Import merge: incoming records win for ids that already exist. */
export async function mergeById(dek: CryptoKey, records: BudgetRecord[]): Promise<void> {
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

/** Validates one record coming from a backup file. Returns null when unusable. */
export function parseRecord(value: unknown): BudgetRecord | null {
  if (!isObject(value)) return null;
  const id = asString(value["id"]);
  const type = asString(value["type"]);
  if (!id || !type) return null;

  if (type === "category") {
    const name = asString(value["name"]);
    const kind = value["kind"] === "fixed" ? "fixed" : "variable";
    const plan = asInteger(value["monthlyPlanCents"]);
    const colour = asString(value["colour"]);
    const sortIndex = asInteger(value["sortIndex"]);
    if (name === null || plan === null) return null;
    const category: Category = {
      id,
      type: "category",
      name,
      kind,
      monthlyPlanCents: plan,
      colour: colour && /^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : PALETTE[0],
      archived: value["archived"] === true,
      sortIndex: sortIndex ?? 0,
    };
    return category;
  }

  if (type === "transaction") {
    const date = asString(value["date"]);
    const amountCents = asInteger(value["amountCents"]);
    const categoryId = asString(value["categoryId"]);
    const note = asString(value["note"]) ?? "";
    const createdAt = asString(value["createdAt"]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (amountCents === null || !categoryId) return null;
    const transaction: Transaction = {
      id,
      type: "transaction",
      date,
      amountCents,
      categoryId,
      note,
      createdAt: createdAt ?? new Date().toISOString(),
    };
    return transaction;
  }

  if (type === "settings") {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      locale: value["locale"] === "en-IE" ? "en-IE" : "de-DE",
      monthStartDay: Math.min(Math.max(asInteger(value["monthStartDay"]) ?? 1, 1), 28),
      autoLockSeconds: Math.min(Math.max(asInteger(value["autoLockSeconds"]) ?? 120, 30), 900),
      lockOnBackground: value["lockOnBackground"] !== false,
      wipeAfterFailures: value["wipeAfterFailures"] === true,
      lastExportAt: asString(value["lastExportAt"]),
    };
    return settings;
  }

  return null;
}
