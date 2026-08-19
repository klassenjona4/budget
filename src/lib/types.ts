export type CategoryKind = "fixed" | "variable";

export type Locale = "de-DE" | "en-IE";

export type Category = {
  id: string;
  type: "category";
  name: string;
  kind: CategoryKind;
  colour: string; // hex, chosen from a fixed palette
  archived: boolean;
  sortIndex: number;
  /** Reserved categories cannot be renamed or archived by hand. */
  system?: "correction";
};

export type Transaction = {
  id: string;
  type: "transaction";
  date: string; // ISO date, no time component, local date
  amountCents: number; // negative expense, positive income
  categoryId: string;
  note: string;
  createdAt: string; // ISO timestamp
  /** Balance corrections move the balance but are not spending. */
  kind?: "adjustment";
  /** Set when the row was posted automatically by a recurring payment. */
  recurrenceId?: string;
};

export type RecurrenceInterval = "weekly" | "monthly" | "yearly";

export type Recurrence = {
  id: string;
  type: "recurrence";
  name: string;
  amountCents: number; // negative expense, positive income
  categoryId: string;
  interval: RecurrenceInterval;
  /** 1 to 28 for monthly and yearly. */
  dayOfMonth: number;
  /** 0 is Sunday, used by the weekly interval only. */
  weekday: number;
  /** 1 to 12, used by the yearly interval only. */
  month: number;
  startDate: string; // ISO date, first date it may post
  endDate: string | null;
  /** Last date already posted, so a restart cannot double post. */
  lastPostedDate: string | null;
  active: boolean;
};

export type NotificationSettings = {
  enabled: boolean;
  /** Local hour, 0 to 23. */
  morningHour: number;
  eveningHour: number;
  paceAlerts: boolean;
};

export type Settings = {
  id: "settings";
  type: "settings";
  locale: Locale;
  monthStartDay: number; // 1 to 28, default 1
  autoLockSeconds: number;
  lockOnBackground: boolean;
  wipeAfterFailures: boolean;
  lastExportAt: string | null;
  storagePersisted: boolean;
  /** Balance at openingBalanceDate, everything after it is derived. */
  openingBalanceCents: number;
  openingBalanceDate: string;
  /** One target for the whole month, in cents. Zero means no target. */
  monthlyTargetCents: number;
  notifications: NotificationSettings;
  /** ISO dates of the last starter and recap that were shown. */
  lastMorningNotice: string | null;
  lastEveningNotice: string | null;
};

export type BudgetRecord = Category | Transaction | Settings | Recurrence;

export type RecordType = BudgetRecord["type"];

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: false,
  morningHour: 6,
  eveningHour: 21,
  paceAlerts: true,
};

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
  openingBalanceCents: 0,
  openingBalanceDate: "1970-01-01",
  monthlyTargetCents: 0,
  notifications: DEFAULT_NOTIFICATIONS,
  lastMorningNotice: null,
  lastEveningNotice: null,
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

export const CORRECTION_CATEGORY_NAME = "Balance correction";

type SeedCategory = { name: string; kind: CategoryKind };

/** Seed categories created once during setup. */
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
  { name: "Income", kind: "variable" },
  { name: "Other", kind: "variable" },
];
