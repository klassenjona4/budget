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
import { currentBalance } from "../lib/balance.ts";
import { summariseMonth } from "../lib/insights.ts";
import { pendingPosts, postsFor } from "../lib/recurrence.ts";
import { currentPeriod, today } from "../lib/period.ts";
import {
  buildCorrectionCategory,
  correctionCategory,
  loadAll,
  removeRecord,
  replaceAll,
  saveRecord,
  saveRecords,
  seedInitialData,
  sortCategories,
  sortRecurrences,
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
import {
  disableDailyWakeups,
  enableDailyWakeups,
  notify,
  requestPermission,
} from "../lib/notifications.ts";
import { DEFAULT_SETTINGS, PALETTE } from "../lib/types.ts";
import type {
  Category,
  CategoryKind,
  NotificationSettings,
  Recurrence,
  Settings,
  Transaction,
} from "../lib/types.ts";

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
  colour: string;
};

export type NewRecurrence = Omit<Recurrence, "id" | "type" | "lastPostedDate">;

export type ImportMode = "replace" | "merge";

export type NoticeKind = "morning" | "evening";

export type StoreState = {
  status: Status;
  biometric: BiometricMode | null;
  biometricAvailable: boolean;
  categories: Category[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  settings: Settings;
  damaged: number;
  /** Rows posted by recurring payments during this unlock. */
  postedThisSession: number;
};

export type StoreActions = {
  setup: (pin: string) => Promise<void>;
  unlockPin: (pin: string) => Promise<void>;
  unlockBiometric: () => Promise<void>;
  lock: () => void;
  addTransaction: (input: NewTransaction) => Promise<void>;
  updateTransaction: (transaction: Transaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  correctBalance: (actualCents: number) => Promise<void>;
  addCategory: (input: NewCategory) => Promise<void>;
  updateCategory: (category: Category) => Promise<void>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
  addRecurrence: (input: NewRecurrence) => Promise<void>;
  updateRecurrence: (recurrence: Recurrence) => Promise<void>;
  deleteRecurrence: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  updateNotifications: (patch: Partial<NotificationSettings>) => Promise<NotificationPermission>;
  markNoticeShown: (kind: NoticeKind) => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<void>;
  enrolBiometric: (pin: string) => Promise<BiometricMode>;
  removeBiometric: () => Promise<void>;
  exportBackup: (passphrase: string) => Promise<string>;
  exportCsv: () => void;
  importBackup: (text: string, passphrase: string, mode: ImportMode) => Promise<number>;
  requestPersist: () => Promise<boolean>;
  wipeAll: () => Promise<void>;
  resetToSetup: () => void;
};

const StateContext = createContext<StoreState | null>(null);
const ActionsContext = createContext<StoreActions | null>(null);

const EMPTY: VaultData = {
  categories: [],
  transactions: [],
  recurrences: [],
  settings: DEFAULT_SETTINGS,
  damaged: 0,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [biometric, setBiometric] = useState<BiometricMode | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [data, setDataState] = useState<VaultData>(EMPTY);
  const [postedThisSession, setPostedThisSession] = useState(0);
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
    setPostedThisSession(0);
    setStatus((current) => (current === "setup" ? current : "locked"));
  }, [setData]);

  /**
   * Posts every recurring payment that fell due while the app was closed.
   * Each recurrence records the last date it posted, so this is safe to run
   * on every unlock.
   */
  const postDue = useCallback(async (key: CryptoKey, loaded: VaultData): Promise<VaultData> => {
    const todayIso = today();
    const pending = pendingPosts(loaded.recurrences, todayIso);
    if (pending.length === 0) return loaded;

    const transactions: Transaction[] = [];
    const recurrences = [...loaded.recurrences];
    for (const item of pending) {
      transactions.push(...postsFor(item.recurrence, item.dates, newId));
      const index = recurrences.findIndex((row) => row.id === item.recurrence.id);
      const lastDate = item.dates[item.dates.length - 1];
      if (index >= 0 && lastDate) {
        recurrences[index] = { ...item.recurrence, lastPostedDate: lastDate };
      }
    }

    await saveRecords(key, [...transactions, ...recurrences.filter((row) => row.active)]);
    setPostedThisSession(transactions.length);
    return {
      ...loaded,
      transactions: sortTransactions([...loaded.transactions, ...transactions]),
      recurrences: sortRecurrences(recurrences),
    };
  }, []);

  /** Runs after a successful unlock: keeps the DEK, then asks for persistence. */
  const afterUnlock = useCallback(
    async (key: CryptoKey, loaded: VaultData) => {
      const withPosts = await postDue(key, loaded);
      dekRef.current = key;
      lastActivityRef.current = Date.now();
      setData(withPosts);
      setStatus("unlocked");

      const persisted = (await isStoragePersisted()) || (await requestPersistentStorage());
      if (persisted !== withPosts.settings.storagePersisted) {
        const settings: Settings = { ...dataRef.current.settings, storagePersisted: persisted };
        await saveRecord(key, settings);
        setData((current) => ({ ...current, settings }));
      }
    },
    [postDue, setData],
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

  /**
   * Fires once, on the entry that tips the month past the pace the target
   * allows. The body carries no figures, because the notification may sit on
   * a lock screen.
   */
  const alertIfOverPace = useCallback(async (before: VaultData, after: VaultData) => {
    const settings = after.settings;
    if (!settings.notifications.enabled || !settings.notifications.paceAlerts) return;
    if (settings.monthlyTargetCents <= 0) return;
    const period = currentPeriod(settings.monthStartDay);
    const was = summariseMonth(before.categories, before.transactions, period, settings);
    const now = summariseMonth(after.categories, after.transactions, period, settings);
    if (was.status !== "over" && now.status === "over") {
      await notify(
        "Budget",
        "Spending has moved ahead of the pace your monthly target allows. Open the app for the figures.",
        "pace-alert",
      );
    }
  }, []);

  const addTransaction = useCallback(
    async (input: NewTransaction) => {
      const before = dataRef.current;
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
      await alertIfOverPace(before, dataRef.current);
    },
    [alertIfOverPace, dek, setData],
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

  /**
   * Books the difference between the ledger and the real account as an
   * adjustment, so the balance line matches the bank without rewriting history.
   */
  const correctBalance = useCallback(
    async (actualCents: number) => {
      const current = dataRef.current;
      const todayIso = today();
      const difference = actualCents - currentBalance(current.settings, current.transactions, todayIso);
      if (difference === 0) return;
      // A vault from before corrections existed has no reserved category yet.
      let category = correctionCategory(current.categories);
      if (!category) {
        category = buildCorrectionCategory(current.categories.length);
        await saveRecord(dek(), category);
        const created = category;
        setData((state) => ({
          ...state,
          categories: sortCategories([...state.categories, created]),
        }));
      }
      const transaction: Transaction = {
        id: newId(),
        type: "transaction",
        date: todayIso,
        amountCents: difference,
        categoryId: category.id,
        note: "Balance corrected to the actual account",
        createdAt: new Date().toISOString(),
        kind: "adjustment",
      };
      await saveRecord(dek(), transaction);
      setData((state) => ({
        ...state,
        transactions: sortTransactions([...state.transactions, transaction]),
      }));
    },
    [dek, setData],
  );

  const addCategory = useCallback(
    async (input: NewCategory) => {
      const category: Category = {
        id: newId(),
        type: "category",
        name: input.name,
        kind: input.kind,
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

  const addRecurrence = useCallback(
    async (input: NewRecurrence) => {
      const recurrence: Recurrence = { ...input, id: newId(), type: "recurrence", lastPostedDate: null };
      const key = dek();
      await saveRecord(key, recurrence);
      const withPosts = await postDue(key, {
        ...dataRef.current,
        recurrences: sortRecurrences([...dataRef.current.recurrences, recurrence]),
      });
      setData(withPosts);
    },
    [dek, postDue, setData],
  );

  const updateRecurrence = useCallback(
    async (recurrence: Recurrence) => {
      await saveRecord(dek(), recurrence);
      setData((current) => ({
        ...current,
        recurrences: sortRecurrences(
          current.recurrences.map((row) => (row.id === recurrence.id ? recurrence : row)),
        ),
      }));
    },
    [dek, setData],
  );

  const deleteRecurrence = useCallback(
    async (id: string) => {
      await removeRecord(id);
      setData((current) => ({
        ...current,
        recurrences: current.recurrences.filter((row) => row.id !== id),
      }));
    },
    [setData],
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

  /**
   * Turning notifications on asks for permission and registers the background
   * wake up. Both can fail without stopping the setting from being saved,
   * because the in-app cards work either way.
   */
  const updateNotifications = useCallback(
    async (patch: Partial<NotificationSettings>): Promise<NotificationPermission> => {
      const next: NotificationSettings = { ...dataRef.current.settings.notifications, ...patch };
      let permission: NotificationPermission =
        typeof Notification === "undefined" ? "denied" : Notification.permission;

      if (next.enabled) {
        if (permission === "default") permission = await requestPermission();
        if (permission === "granted") await enableDailyWakeups();
        else next.enabled = false;
      } else {
        await disableDailyWakeups();
      }

      const settings: Settings = { ...dataRef.current.settings, notifications: next };
      await saveRecord(dek(), settings);
      setData((current) => ({ ...current, settings }));
      return permission;
    },
    [dek, setData],
  );

  const markNoticeShown = useCallback(
    async (kind: NoticeKind) => {
      const stamp = today();
      const settings: Settings = {
        ...dataRef.current.settings,
        ...(kind === "morning" ? { lastMorningNotice: stamp } : { lastEveningNotice: stamp }),
      };
      await saveRecord(dek(), settings);
      setData((current) => ({ ...current, settings }));
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
      const records = [
        current.settings,
        ...current.categories,
        ...current.recurrences,
        ...current.transactions,
      ];
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
      recurrences: data.recurrences,
      settings: data.settings,
      damaged: data.damaged,
      postedThisSession,
    }),
    [biometric, biometricAvailable, data, postedThisSession, status],
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
      correctBalance,
      addCategory,
      updateCategory,
      reorderCategories,
      addRecurrence,
      updateRecurrence,
      deleteRecurrence,
      updateSettings,
      updateNotifications,
      markNoticeShown,
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
      addRecurrence,
      addTransaction,
      changePin,
      correctBalance,
      deleteRecurrence,
      deleteTransaction,
      enrolBiometric,
      exportBackup,
      exportCsv,
      importBackup,
      lock,
      markNoticeShown,
      removeBiometric,
      reorderCategories,
      requestPersist,
      resetToSetup,
      setup,
      unlockBiometric,
      unlockPin,
      updateCategory,
      updateNotifications,
      updateRecurrence,
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
