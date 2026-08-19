/**
 * Application state. Holds the decrypted records for as long as the vault is
 * unlocked, and drops all of it on lock. Nothing here is written to
 * localStorage or sessionStorage at any point.
 *
 * State and actions live in two contexts. The action object keeps a stable
 * identity, so an effect can depend on it without re running every time a
 * record changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { newId } from "../lib/crypto.ts";
import { isStoragePersisted, requestPersistentStorage } from "../lib/db.ts";
import {
  createCsv,
  createEncryptedBackup,
  csvFilename,
  downloadBlob,
  readEncryptedBackup,
} from "../lib/backup.ts";
import {
  loadAll,
  removeRecord,
  replaceAll,
  saveRecord,
  saveRecords,
  seedInitialData,
  sortCategories,
  sortTransactions,
  type VaultData,
} from "../lib/records.ts";
import {
  changePin as vaultChangePin,
  enrolBiometric as vaultEnrolBiometric,
  getVaultStatus,
  isBiometricAvailable,
  removeBiometric as vaultRemoveBiometric,
  setupWithPin,
  setWipeAfterFailures,
  unlockWithBiometric,
  unlockWithPin,
  wipeAll as vaultWipeAll,
  type BiometricMode,
} from "../lib/vault.ts";
import { DEFAULT_SETTINGS, PALETTE } from "../lib/types.ts";
import type { Category, CategoryKind, Settings, Transaction } from "../lib/types.ts";

export type Status = "loading" | "setup" | "locked" | "unlocked";

export type NewTransaction = {
  date: string;
  amountCents: number;
  categoryId: string;
  note: string;
};

export type NewCategory = {
  name: string;
  kind: CategoryKind;
  monthlyPlanCents: number;
  colour: string;
};

export type ImportMode = "replace" | "merge";

export type StoreState = {
  status: Status;
  biometric: BiometricMode | null;
  biometricAvailable: boolean;
  categories: Category[];
  transactions: Transaction[];
  settings: Settings;
  damaged: number;
};

export type StoreActions = {
  setup: (pin: string) => Promise<void>;
  unlockPin: (pin: string) => Promise<void>;
  unlockBiometric: () => Promise<void>;
  lock: () => void;
  addTransaction: (input: NewTransaction) => Promise<void>;
  updateTransaction: (transaction: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (input: NewCategory) => Promise<void>;
  updateCategory: (category: Category) => Promise<void>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<void>;
  enrolBiometric: (pin: string) => Promise<BiometricMode>;
  removeBiometric: () => Promise<void>;
  exportBackup: (passphrase: string) => Promise<string>;
  exportCsv: () => void;
  importBackup: (text: string, passphrase: string, mode: ImportMode) => Promise<number>;
  requestPersist: () => Promise<boolean>;
  wipeAll: () => Promise<void>;
  /** Returns the app to first run state after the vault was destroyed. */
  resetToSetup: () => void;
};

const StateContext = createContext<StoreState | null>(null);
const ActionsContext = createContext<StoreActions | null>(null);

const EMPTY: VaultData = {
  categories: [],
  transactions: [],
  settings: DEFAULT_SETTINGS,
  damaged: 0,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [biometric, setBiometric] = useState<BiometricMode | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [data, setDataState] = useState<VaultData>(EMPTY);
  const dataRef = useRef<VaultData>(EMPTY);
  const dekRef = useRef<CryptoKey | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  /** Single write path, so the ref used by the actions is always current. */
  const setData = useCallback((next: VaultData | ((current: VaultData) => VaultData)) => {
    const value = typeof next === "function" ? next(dataRef.current) : next;
    dataRef.current = value;
    setDataState(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [vault, available] = await Promise.all([getVaultStatus(), isBiometricAvailable()]);
      if (cancelled) return;
      setBiometric(vault.biometric);
      setBiometricAvailable(available);
      setStatus(vault.initialised ? "locked" : "setup");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dek = useCallback((): CryptoKey => {
    const key = dekRef.current;
    if (!key) throw new Error("The vault is locked.");
    return key;
  }, []);

  const lock = useCallback(() => {
    dekRef.current = null;
    setData(EMPTY);
    setStatus((current) => (current === "setup" ? current : "locked"));
  }, [setData]);

  /** Runs after a successful unlock: keeps the DEK, then asks for persistence. */
  const afterUnlock = useCallback(
    async (key: CryptoKey, loaded: VaultData) => {
      dekRef.current = key;
      lastActivityRef.current = Date.now();
      setData(loaded);
      setStatus("unlocked");

      const persisted = (await isStoragePersisted()) || (await requestPersistentStorage());
      if (persisted !== loaded.settings.storagePersisted) {
        const settings: Settings = { ...dataRef.current.settings, storagePersisted: persisted };
        await saveRecord(key, settings);
        setData((current) => ({ ...current, settings }));
      }
    },
    [setData],
  );

  const setup = useCallback(
    async (pin: string) => {
      const session = await setupWithPin(pin);
      const seeded = await seedInitialData(session.dek);
      await afterUnlock(session.dek, seeded);
    },
    [afterUnlock],
  );

  const unlockPin = useCallback(
    async (pin: string) => {
      const session = await unlockWithPin(pin);
      await afterUnlock(session.dek, await loadAll(session.dek));
    },
    [afterUnlock],
  );

  const unlockBiometric = useCallback(async () => {
    const session = await unlockWithBiometric();
    await afterUnlock(session.dek, await loadAll(session.dek));
  }, [afterUnlock]);

  const addTransaction = useCallback(
    async (input: NewTransaction) => {
      const transaction: Transaction = {
        id: newId(),
        type: "transaction",
        date: input.date,
        amountCents: input.amountCents,
        categoryId: input.categoryId,
        note: input.note,
        createdAt: new Date().toISOString(),
      };
      await saveRecord(dek(), transaction);
      setData((current) => ({
        ...current,
        transactions: sortTransactions([...current.transactions, transaction]),
      }));
    },
    [dek, setData],
  );

  const updateTransaction = useCallback(
    async (transaction: Transaction) => {
      await saveRecord(dek(), transaction);
      setData((current) => ({
        ...current,
        transactions: sortTransactions(
          current.transactions.map((row) => (row.id === transaction.id ? transaction : row)),
        ),
      }));
    },
    [dek, setData],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      await removeRecord(id);
      setData((current) => ({
        ...current,
        transactions: current.transactions.filter((row) => row.id !== id),
      }));
    },
    [setData],
  );

  const addCategory = useCallback(
    async (input: NewCategory) => {
      const category: Category = {
        id: newId(),
        type: "category",
        name: input.name,
        kind: input.kind,
        monthlyPlanCents: input.monthlyPlanCents,
        colour: input.colour || PALETTE[0],
        archived: false,
        sortIndex: dataRef.current.categories.length,
      };
      await saveRecord(dek(), category);
      setData((current) => ({
        ...current,
        categories: sortCategories([...current.categories, category]),
      }));
    },
    [dek, setData],
  );

  const updateCategory = useCallback(
    async (category: Category) => {
      await saveRecord(dek(), category);
      setData((current) => ({
        ...current,
        categories: sortCategories(
          current.categories.map((row) => (row.id === category.id ? category : row)),
        ),
      }));
    },
    [dek, setData],
  );

  const reorderCategories = useCallback(
    async (orderedIds: string[]) => {
      const index = new Map(orderedIds.map((id, position) => [id, position]));
      const next = dataRef.current.categories.map((category) => ({
        ...category,
        sortIndex: index.get(category.id) ?? category.sortIndex,
      }));
      await saveRecords(dek(), next);
      setData((current) => ({ ...current, categories: sortCategories(next) }));
    },
    [dek, setData],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const settings: Settings = {
        ...dataRef.current.settings,
        ...patch,
        id: "settings",
        type: "settings",
      };
      await saveRecord(dek(), settings);
      if (patch.wipeAfterFailures !== undefined) {
        await setWipeAfterFailures(settings.wipeAfterFailures);
      }
      setData((current) => ({ ...current, settings }));
      lastActivityRef.current = Date.now();
    },
    [dek, setData],
  );

  const changePin = useCallback(async (oldPin: string, newPin: string) => {
    await vaultChangePin(oldPin, newPin);
  }, []);

  const enrolBiometric = useCallback(async (pin: string) => {
    const mode = await vaultEnrolBiometric(pin);
    setBiometric(mode);
    return mode;
  }, []);

  const removeBiometric = useCallback(async () => {
    await vaultRemoveBiometric();
    setBiometric(null);
  }, []);

  const exportBackup = useCallback(
    async (passphrase: string) => {
      const current = dataRef.current;
      const records = [current.settings, ...current.categories, ...current.transactions];
      const { filename, blob } = await createEncryptedBackup(records, passphrase);
      downloadBlob(blob, filename);
      const settings: Settings = { ...current.settings, lastExportAt: new Date().toISOString() };
      await saveRecord(dek(), settings);
      setData((state) => ({ ...state, settings }));
      return filename;
    },
    [dek, setData],
  );

  const exportCsv = useCallback(() => {
    const current = dataRef.current;
    downloadBlob(createCsv(current.transactions, current.categories), csvFilename());
  }, []);

  const importBackup = useCallback(
    async (text: string, passphrase: string, mode: ImportMode) => {
      const records = await readEncryptedBackup(text, passphrase);
      const key = dek();
      if (mode === "replace") await replaceAll(key, records);
      else await saveRecords(key, records);
      setData(await loadAll(key));
      return records.length;
    },
    [dek, setData],
  );

  const requestPersist = useCallback(async () => {
    const granted = await requestPersistentStorage();
    const settings: Settings = { ...dataRef.current.settings, storagePersisted: granted };
    await saveRecord(dek(), settings);
    setData((current) => ({ ...current, settings }));
    return granted;
  }, [dek, setData]);

  const resetToSetup = useCallback(() => {
    dekRef.current = null;
    setData(EMPTY);
    setBiometric(null);
    setStatus("setup");
  }, [setData]);

  const wipeAll = useCallback(async () => {
    await vaultWipeAll();
    resetToSetup();
  }, [resetToSetup]);

  // Auto lock. The timer is reset by any interaction and re checked whenever
  // the app comes back to the foreground, because timers do not run reliably
  // while a tab is hidden.
  useEffect(() => {
    if (status !== "unlocked") return;
    const limitMs = data.settings.autoLockSeconds * 1000;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const check = () => {
      if (Date.now() - lastActivityRef.current >= limitMs) lock();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (data.settings.lockOnBackground) lock();
      } else {
        check();
      }
    };

    const events: (keyof DocumentEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel"];
    for (const event of events) document.addEventListener(event, markActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(check, 1000);

    return () => {
      for (const event of events) document.removeEventListener(event, markActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [data.settings.autoLockSeconds, data.settings.lockOnBackground, lock, status]);

  const state = useMemo<StoreState>(
    () => ({
      status,
      biometric,
      biometricAvailable,
      categories: data.categories,
      transactions: data.transactions,
      settings: data.settings,
      damaged: data.damaged,
    }),
    [biometric, biometricAvailable, data, status],
  );

  const actions = useMemo<StoreActions>(
    () => ({
      setup,
      unlockPin,
      unlockBiometric,
      lock,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addCategory,
      updateCategory,
      reorderCategories,
      updateSettings,
      changePin,
      enrolBiometric,
      removeBiometric,
      exportBackup,
      exportCsv,
      importBackup,
      requestPersist,
      wipeAll,
      resetToSetup,
    }),
    [
      addCategory,
      addTransaction,
      changePin,
      deleteTransaction,
      enrolBiometric,
      exportBackup,
      exportCsv,
      importBackup,
      lock,
      removeBiometric,
      reorderCategories,
      requestPersist,
      resetToSetup,
      setup,
      unlockBiometric,
      unlockPin,
      updateCategory,
      updateSettings,
      updateTransaction,
      wipeAll,
    ],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useStoreState(): StoreState {
  const state = useContext(StateContext);
  if (!state) throw new Error("useStoreState was called outside the provider.");
  return state;
}

/** Stable across renders, safe to use in an effect dependency list. */
export function useActions(): StoreActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useActions was called outside the provider.");
  return actions;
}
