/**
 * Local notifications. Nothing is pushed from a server, so there is no
 * subscription and no endpoint. The service worker shows the notification
 * itself, which means it can only carry generic text: the encryption key
 * lives in the page, so the worker cannot read any figures. The numbers are
 * shown in the app once it is unlocked.
 */

export type NotificationSupport = {
  notifications: boolean;
  /** Background wake ups, Chrome on Android for an installed app. */
  periodicSync: boolean;
  permission: NotificationPermission;
};

export const DAILY_SYNC_TAG = "budget-daily";

/** Twelve hours, so Chrome can fit a morning and an evening wake up. */
const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

type PeriodicSyncManager = {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
};

function periodicSyncOf(
  registration: ServiceWorkerRegistration,
): PeriodicSyncManager | undefined {
  return (registration as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager })
    .periodicSync;
}

async function registrationOrNull(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.ready) ?? null;
  } catch {
    return null;
  }
}

export async function support(): Promise<NotificationSupport> {
  const notifications = typeof Notification !== "undefined";
  const registration = await registrationOrNull();
  return {
    notifications,
    periodicSync: registration ? periodicSyncOf(registration) !== undefined : false,
    permission: notifications ? Notification.permission : "denied",
  };
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Asks Chrome to wake the worker roughly twice a day. The browser decides the
 * exact moment from how the app is used, so the times are approximate. The
 * permission is only granted to installed apps.
 */
export async function enableDailyWakeups(): Promise<"enabled" | "denied" | "unsupported"> {
  const registration = await registrationOrNull();
  const periodicSync = registration ? periodicSyncOf(registration) : undefined;
  if (!periodicSync) return "unsupported";
  try {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as PermissionName,
    });
    if (status.state === "denied") return "denied";
  } catch {
    // Some browsers do not expose the permission, registering will tell us.
  }
  try {
    await periodicSync.register(DAILY_SYNC_TAG, { minInterval: MIN_INTERVAL_MS });
    return "enabled";
  } catch {
    return "denied";
  }
}

export async function disableDailyWakeups(): Promise<void> {
  const registration = await registrationOrNull();
  const periodicSync = registration ? periodicSyncOf(registration) : undefined;
  if (!periodicSync) return;
  try {
    await periodicSync.unregister(DAILY_SYNC_TAG);
  } catch {
    // Nothing to do, the tag was not registered.
  }
}

export async function dailyWakeupsActive(): Promise<boolean> {
  const registration = await registrationOrNull();
  const periodicSync = registration ? periodicSyncOf(registration) : undefined;
  if (!periodicSync) return false;
  try {
    return (await periodicSync.getTags()).includes(DAILY_SYNC_TAG);
  } catch {
    return false;
  }
}

/**
 * Shows a notification from the app itself. Used for pace alerts while the
 * app is open, where the figures are already decrypted and on screen.
 */
export async function notify(title: string, body: string, tag: string): Promise<boolean> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const registration = await registrationOrNull();
  if (!registration) return false;
  try {
    await registration.showNotification(title, {
      body,
      tag,
      icon: "icon-192.png",
      badge: "icon-192.png",
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}
