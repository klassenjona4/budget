export type CategoryKind = "fixed" | "variable";

export type Locale = "de-DE" | "en-IE";

export type Category = {
  id: string;
  type: "category";
  name: string;
  kind: CategoryKind;
  monthlyPlanCents: number;
  colour: string; // hex, chosen from a fixed palette
  archived: boolean;
  sortIndex: number;
};

export type Transaction = {
  id: string;
  type: "transaction";
  date: string; // ISO date, no time component, local date
  amountCents: number; // negative expense, positive income
  categoryId: string;
  note: string;
  createdAt: string; // ISO timestamp
};

export type Settings = {
  id: "settings";
  type: "settings";
  locale: Locale;
  monthStartDay: number; // 1 to 28, default 1
  autoLockSeconds: number;
  lockOnBackground: boolean;
  wipeAfterFailures: boolean;
  lastExportAt: string | null; // ISO timestamp of the last encrypted backup
  storagePersisted: boolean;
};

export type BudgetRecord = Category | Transaction | Settings;

export type RecordType = BudgetRecord["type"];

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  type: "settings",
  locale: "de-DE",
  monthStartDay: 1,
  autoLockSeconds: 120,
  lockOnBackground: true,
  wipeAfterFailures: false,
  lastExportAt: null,
  storagePersisted: false,
};

/** Fixed palette. Categories may only use one of these values. */
export const PALETTE = [
  "#4C8DFF",
  "#39C0C8",
  "#5AD18B",
  "#C9D64A",
  "#F0B23C",
  "#F07A4B",
  "#E85F7A",
  "#B778E8",
  "#8A93B5",
] as const;

type SeedCategory = { name: string; kind: CategoryKind };

/** Seed categories created once during setup, every plan starts at 0 cents. */
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { name: "Rent", kind: "fixed" },
  { name: "Utilities", kind: "fixed" },
  { name: "Groceries", kind: "variable" },
  { name: "Eating out", kind: "variable" },
  { name: "Transport", kind: "variable" },
  { name: "Phone and internet", kind: "fixed" },
  { name: "University fees", kind: "fixed" },
  { name: "Sport and gym", kind: "variable" },
  { name: "Bike", kind: "variable" },
  { name: "Health", kind: "variable" },
  { name: "Clothing", kind: "variable" },
  { name: "Savings", kind: "variable" },
  { name: "Other", kind: "variable" },
];
