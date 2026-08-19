/**
 * Backup, export and import.
 * Deleting the home screen icon on iOS deletes the database with it, so the
 * encrypted backup is the only recovery route that exists.
 */
import {
  decryptText,
  deriveKekFromPassphrase,
  encryptText,
  fromBase64,
  newSalt,
  PBKDF2_ITERATIONS,
  toBase64,
} from "./crypto.ts";
import { parseRecord } from "./records.ts";
import { formatCentsPlain } from "./money.ts";
import type { BudgetRecord, Category, Transaction } from "./types.ts";

export const BACKUP_VERSION = 1;

/** Prompt for a fresh backup once the last one is this old. */
export const EXPORT_REMINDER_DAYS = 30;

type BackupFile = {
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number };
  salt: string;
  iv: string;
  ct: string;
};

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

export class BackupPassphraseError extends Error {
  constructor() {
    super("The passphrase does not match this file. Nothing was changed.");
    this.name = "BackupPassphraseError";
  }
}

function backupFilename(now: Date): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `budget-backup-${year}-${month}-${day}.json`;
}

/**
 * Serialises every record, then encrypts with AES-GCM 256 under a key derived
 * from the passphrase with PBKDF2-SHA256, 600000 iterations and a fresh salt.
 */
export async function createEncryptedBackup(
  records: BudgetRecord[],
  passphrase: string,
  now: Date = new Date(),
): Promise<{ filename: string; blob: Blob }> {
  const salt = newSalt();
  const key = await deriveKekFromPassphrase(passphrase, salt);
  const sealed = await encryptText(key, JSON.stringify({ records }));
  const file: BackupFile = {
    version: BACKUP_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS },
    salt: toBase64(salt),
    iv: toBase64(sealed.iv),
    ct: toBase64(sealed.ct),
  };
  return {
    filename: backupFilename(now),
    blob: new Blob([JSON.stringify(file)], { type: "application/json" }),
  };
}

function readBackupFile(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError("This file is not a backup file.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BackupFormatError("This file is not a backup file.");
  }
  const candidate = parsed as Partial<BackupFile>;
  if (candidate.version !== BACKUP_VERSION) {
    throw new BackupFormatError(
      `Backup version ${String(candidate.version)} cannot be read by this app version.`,
    );
  }
  const iterations = candidate.kdf?.iterations;
  if (
    candidate.kdf?.name !== "PBKDF2" ||
    candidate.kdf.hash !== "SHA-256" ||
    typeof iterations !== "number"
  ) {
    throw new BackupFormatError("The backup header is not readable.");
  }
  if (
    typeof candidate.salt !== "string" ||
    typeof candidate.iv !== "string" ||
    typeof candidate.ct !== "string"
  ) {
    throw new BackupFormatError("The backup header is not readable.");
  }
  return candidate as BackupFile;
}

/**
 * Validates the header, decrypts with the passphrase, then validates every
 * record. Nothing is written to the database here, so a failure is harmless.
 */
export async function readEncryptedBackup(
  text: string,
  passphrase: string,
): Promise<BudgetRecord[]> {
  const file = readBackupFile(text);
  const key = await deriveKekFromPassphrase(
    passphrase,
    fromBase64(file.salt),
    file.kdf.iterations,
  );

  let plaintext: string;
  try {
    plaintext = await decryptText(key, { iv: fromBase64(file.iv), ct: fromBase64(file.ct) });
  } catch {
    throw new BackupPassphraseError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new BackupFormatError("The backup content is damaged.");
  }
  const rows =
    typeof payload === "object" && payload !== null
      ? (payload as { records?: unknown }).records
      : null;
  if (!Array.isArray(rows)) throw new BackupFormatError("The backup content is damaged.");

  const records: BudgetRecord[] = [];
  for (const row of rows) {
    const record = parseRecord(row);
    if (record) records.push(record);
  }
  if (records.length === 0) throw new BackupFormatError("The backup contains no usable records.");
  return records;
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Unencrypted CSV: date,category,amount_eur,note, oldest first. */
export function createCsv(transactions: Transaction[], categories: Category[]): Blob {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const rows = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  const lines = ["date,category,amount_eur,note"];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        csvField(names.get(row.categoryId) ?? "Unknown"),
        formatCentsPlain(row.amountCents),
        csvField(row.note),
      ].join(","),
    );
  }
  return new Blob([lines.join("\n")], { type: "text/csv" });
}

export function csvFilename(now: Date = new Date()): string {
  return backupFilename(now).replace("budget-backup-", "budget-export-").replace(".json", ".csv");
}

/**
 * Hands a Blob to the browser as a download. On iOS this opens the share
 * sheet with Save to Files, which is the only way to get the file off the app.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Days since the last encrypted backup, or null when there has never been one. */
export function daysSinceExport(lastExportAt: string | null, now: Date = new Date()): number | null {
  if (!lastExportAt) return null;
  const then = new Date(lastExportAt).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}
