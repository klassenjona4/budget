/**
 * IndexedDB access. Nothing outside this module may touch indexedDB.
 *
 * Store "records" holds one row per record. Only id and type are plaintext,
 * the payload is AES-GCM ciphertext.
 * Store "meta" holds key material and the failure counter. It never holds
 * user data.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { RecordType } from "./types.ts";

const DB_NAME = "budget";
const DB_VERSION = 1;

export type StoredRecord = {
  id: string;
  type: RecordType;
  iv: Uint8Array;
  ct: Uint8Array;
};

/** Wrapped DEK under the PIN derived key encryption key. */
export type PinKeyMaterial = {
  saltPin: Uint8Array;
  iterations: number;
  iv: Uint8Array;
  wrapped: Uint8Array;
};

/**
 * Wrapped DEK under the biometric path.
 * mode "prf" means the key material comes from the authenticator itself.
 * mode "gate" means the wrapping key sits on the device and the biometric
 * check only guards the interface.
 */
export type BioKeyMaterial =
  | {
      mode: "prf";
      credentialId: Uint8Array;
      prfSalt: Uint8Array;
      saltBio: Uint8Array;
      iv: Uint8Array;
      wrapped: Uint8Array;
    }
  | {
      mode: "gate";
      credentialId: Uint8Array;
      deviceKey: Uint8Array;
      iv: Uint8Array;
      wrapped: Uint8Array;
    };

export type VaultMeta = {
  version: 1;
  pin: PinKeyMaterial;
  bio: BioKeyMaterial | null;
  userHandle: Uint8Array;
  /**
   * Mirror of the settings flag of the same name. The lock screen has to read
   * it before the vault is open, so it cannot live only in the encrypted
   * settings record.
   */
  wipeAfterFailures: boolean;
};

export type FailureState = {
  count: number;
  lockedUntil: number; // epoch milliseconds, 0 when not locked out
};

export const NO_FAILURES: FailureState = { count: 0, lockedUntil: 0 };

interface BudgetSchema extends DBSchema {
  records: {
    key: string;
    value: StoredRecord;
    indexes: { byType: RecordType };
  };
  meta: {
    key: string;
    value: VaultMeta | FailureState;
  };
}

let dbPromise: Promise<IDBPDatabase<BudgetSchema>> | null = null;

function db(): Promise<IDBPDatabase<BudgetSchema>> {
  dbPromise ??= openDB<BudgetSchema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const records = database.createObjectStore("records", { keyPath: "id" });
      records.createIndex("byType", "type");
      database.createObjectStore("meta");
    },
  });
  return dbPromise;
}

const META_VAULT = "vault";
const META_FAILURES = "failures";

export async function readVaultMeta(): Promise<VaultMeta | null> {
  const value = await (await db()).get("meta", META_VAULT);
  return (value as VaultMeta | undefined) ?? null;
}

export async function writeVaultMeta(meta: VaultMeta): Promise<void> {
  await (await db()).put("meta", meta, META_VAULT);
}

export async function readFailureState(): Promise<FailureState> {
  const value = await (await db()).get("meta", META_FAILURES);
  return (value as FailureState | undefined) ?? NO_FAILURES;
}

export async function writeFailureState(state: FailureState): Promise<void> {
  await (await db()).put("meta", state, META_FAILURES);
}

export async function listRecords(): Promise<StoredRecord[]> {
  return (await db()).getAll("records");
}

export async function putRecord(record: StoredRecord): Promise<void> {
  await (await db()).put("records", record);
}

export async function putRecords(records: StoredRecord[]): Promise<void> {
  const tx = (await db()).transaction("records", "readwrite");
  await Promise.all(records.map((record) => tx.store.put(record)));
  await tx.done;
}

export async function deleteRecord(id: string): Promise<void> {
  await (await db()).delete("records", id);
}

/** Removes every record but keeps the key material, used by Replace all on import. */
export async function clearRecords(): Promise<void> {
  await (await db()).clear("records");
}

/** Removes every record and all key material. There is no way back from this. */
export async function wipeDatabase(): Promise<void> {
  const database = await db();
  const tx = database.transaction(["records", "meta"], "readwrite");
  await Promise.all([tx.objectStore("records").clear(), tx.objectStore("meta").clear()]);
  await tx.done;
}

/** Asks the browser to exempt this origin from storage eviction. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
