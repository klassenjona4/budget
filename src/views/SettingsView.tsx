import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/Dialog.tsx";
import { PIN_LENGTH, PinEntry } from "../components/PinEntry.tsx";
import { Switch } from "../components/Switch.tsx";
import { isStoragePersisted, storageEstimate } from "../lib/db.ts";
import { centsToDecimalString, formatCents, parseDecimalToCents } from "../lib/money.ts";
import { dailyWakeupsActive, support, type NotificationSupport } from "../lib/notifications.ts";
import { useActions, useStoreState, type ImportMode } from "../state/store.tsx";
import type { Locale } from "../lib/types.ts";
import type { Route } from "../router.ts";

const GATE_EXPLANATION =
  "Mode: gate. The device did not provide key material, so the encryption key is stored on this device and the biometric check is a lock on the interface rather than on the data. The protection rests on the phone lock screen. Any other page published on the same origin could read that stored key, so on a shared host the PIN alone is the stronger choice. The PIN path is unaffected and remains fully encrypted.";

const PRF_EXPLANATION =
  "Mode: prf. The device provided key material, so the biometric is required to reconstruct the encryption key. The data cannot be decrypted without it.";

const AUTO_LOCK_CHOICES = [30, 60, 120, 300, 600, 900];

const HOURS = Array.from({ length: 24 }, (_, index) => index);

function hourLabel(hour: number): string {
  return `${`${hour}`.padStart(2, "0")}:00`;
}

export function SettingsView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const store = useStoreState();
  const actions = useActions();
  const settings = store.settings;
  const { locale } = settings;
  const [dialog, setDialog] = useState<
    "none" | "pin" | "biometric" | "export" | "import" | "wipe" | "balance" | "target"
  >("none");
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>("");
  const [notificationSupport, setNotificationSupport] = useState<NotificationSupport | null>(null);
  const [wakeupsActive, setWakeupsActive] = useState(false);
  const [notificationNote, setNotificationNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setPersisted(await isStoragePersisted());
      const estimate = await storageEstimate();
      if (estimate) setUsage(`${Math.round(estimate.usage / 1024)} kB used of the browser quota`);
      setNotificationSupport(await support());
      setWakeupsActive(await dailyWakeupsActive());
    })();
  }, []);

  async function toggleNotifications(enabled: boolean) {
    const permission = await actions.updateNotifications({ enabled });
    setWakeupsActive(await dailyWakeupsActive());
    setNotificationSupport(await support());
    if (!enabled) {
      setNotificationNote(null);
    } else if (permission === "denied") {
      setNotificationNote(
        "The browser refused notification permission. The recap and starter still appear in the app.",
      );
    } else if (permission === "granted" && !(await dailyWakeupsActive())) {
      setNotificationNote(
        "Notifications are allowed, but this browser will not wake the app in the background. Install the app to the home screen to improve the chances, otherwise the cards wait for you in the app.",
      );
    } else {
      setNotificationNote(null);
    }
  }

  return (
    <main className="screen">
      <div className="stack">
        <h1 className="title">Settings</h1>

        <section className="card stack">
          <h2 className="subtitle">Money</h2>

          <div className="row-between">
            <span className="label">Opening balance</span>
            <button type="button" className="btn" onClick={() => setDialog("balance")}>
              {formatCents(settings.openingBalanceCents, locale)}
            </button>
          </div>
          <div className="field">
            <label className="label" htmlFor="setting-opening-date">
              Applies from
            </label>
            <input
              id="setting-opening-date"
              className="input"
              type="date"
              value={settings.openingBalanceDate}
              onChange={(event) =>
                void actions.updateSettings({
                  openingBalanceDate: event.target.value || settings.openingBalanceDate,
                })
              }
            />
          </div>
          <p className="faint">
            The balance the app counts from. Transactions on or after this date move it, earlier
            ones do not, because the opening figure already includes them. There is no bank
            connection, so the Correct button on the home screen is how you bring it back in line.
          </p>

          <div className="row-between">
            <span className="label">Monthly spending target</span>
            <button type="button" className="btn" onClick={() => setDialog("target")}>
              {settings.monthlyTargetCents > 0
                ? formatCents(settings.monthlyTargetCents, locale)
                : "Not set"}
            </button>
          </div>
          <p className="faint">
            One figure for the whole period. It drives the pace bar, the daily starter and the
            alerts.
          </p>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Notifications</h2>

          <Switch
            label="Daily starter and evening recap"
            checked={settings.notifications.enabled}
            onChange={(checked) => void toggleNotifications(checked)}
          />

          <div className="field">
            <label className="label" htmlFor="setting-morning">
              Starter from
            </label>
            <select
              id="setting-morning"
              className="select num"
              value={settings.notifications.morningHour}
              onChange={(event) =>
                void actions.updateNotifications({ morningHour: Number(event.target.value) })
              }
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="setting-evening">
              Recap from
            </label>
            <select
              id="setting-evening"
              className="select num"
              value={settings.notifications.eveningHour}
              onChange={(event) =>
                void actions.updateNotifications({ eveningHour: Number(event.target.value) })
              }
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>

          <Switch
            label="Warn when spending runs ahead of the target"
            checked={settings.notifications.paceAlerts}
            onChange={(checked) => void actions.updateNotifications({ paceAlerts: checked })}
          />

          {notificationNote ? <p className="notice">{notificationNote}</p> : null}

          <p className="faint">
            The web has no way to schedule a notification for an exact time without a server. With
            permission granted, Android wakes the app roughly twice a day and delivers a prompt near
            the times above. The cards themselves always wait for you in the app from the chosen
            hour onwards, which is the part that never fails.
          </p>
          <p className="faint">
            A background notification carries no figures. The encryption key only exists while the
            app is unlocked, so the worker that shows the notification cannot read your data. That
            also means nothing about your money appears on the lock screen.
          </p>
          {notificationSupport ? (
            <p className="faint num">
              Permission {notificationSupport.permission}, background wake ups{" "}
              {notificationSupport.periodicSync
                ? wakeupsActive
                  ? "registered"
                  : "available"
                : "not supported by this browser"}
              .
            </p>
          ) : null}
        </section>

        <section className="card stack">
          <h2 className="subtitle">Organise</h2>
          <button type="button" className="btn btn--block" onClick={() => onNavigate("recurring")}>
            Recurring payments ({store.recurrences.filter((row) => row.active).length} active)
          </button>
          <button type="button" className="btn btn--block" onClick={() => onNavigate("categories")}>
            Categories ({store.categories.filter((row) => !row.archived).length})
          </button>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Display</h2>
          <div className="field">
            <label className="label" htmlFor="setting-locale">
              Number and date format
            </label>
            <select
              id="setting-locale"
              className="select"
              value={settings.locale}
              onChange={(event) =>
                void actions.updateSettings({ locale: event.target.value as Locale })
              }
            >
              <option value="de-DE">de-DE</option>
              <option value="en-IE">en-IE</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="setting-start-day">
              Budget period starts on day
            </label>
            <select
              id="setting-start-day"
              className="select num"
              value={settings.monthStartDay}
              onChange={(event) =>
                void actions.updateSettings({ monthStartDay: Number(event.target.value) })
              }
            >
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Security</h2>

          <div className="field">
            <label className="label" htmlFor="setting-autolock">
              Auto lock after
            </label>
            <select
              id="setting-autolock"
              className="select num"
              value={settings.autoLockSeconds}
              onChange={(event) =>
                void actions.updateSettings({ autoLockSeconds: Number(event.target.value) })
              }
            >
              {AUTO_LOCK_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </div>

          <Switch
            label="Lock when the app goes to the background"
            checked={settings.lockOnBackground}
            onChange={(checked) => void actions.updateSettings({ lockOnBackground: checked })}
          />

          <Switch
            label="Delete all data after 10 failed PIN attempts"
            description="This is irreversible. An exported backup is the only way to get the data back."
            checked={settings.wipeAfterFailures}
            onChange={(checked) => void actions.updateSettings({ wipeAfterFailures: checked })}
          />

          <button type="button" className="btn btn--block" onClick={() => setDialog("pin")}>
            Change PIN
          </button>

          {store.biometricAvailable ? (
            <div className="stack stack--tight">
              <p className="faint">
                {store.biometric === null
                  ? "Biometric unlock is not set up on this device."
                  : store.biometric === "prf"
                    ? PRF_EXPLANATION
                    : GATE_EXPLANATION}
              </p>
              {store.biometric === null ? (
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => setDialog("biometric")}
                >
                  Set up biometric unlock
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void actions.removeBiometric()}
                >
                  Remove biometric unlock
                </button>
              )}
            </div>
          ) : (
            <p className="faint">
              This device has no built in authenticator, so unlocking uses the PIN only.
            </p>
          )}

          <button type="button" className="btn btn--block" onClick={actions.lock}>
            Lock now
          </button>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Backup</h2>
          <p className="faint">
            Removing the app from the home screen deletes the database with it. An encrypted
            backup is the only recovery route.
          </p>
          <p className="label">
            {settings.lastExportAt
              ? `Last encrypted backup: ${new Date(settings.lastExportAt).toLocaleString(settings.locale)}`
              : "No encrypted backup has been exported yet."}
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => setDialog("export")}
          >
            Export encrypted backup
          </button>
          <button type="button" className="btn btn--block" onClick={actions.exportCsv}>
            Export CSV
          </button>
          <p className="faint">The CSV file is not encrypted. Anyone who opens it can read it.</p>
          <button type="button" className="btn btn--block" onClick={() => setDialog("import")}>
            Import backup
          </button>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Storage</h2>
          <p className="label">
            {persisted === null
              ? "Checking storage status."
              : persisted
                ? "Storage is persistent. The browser will not evict this data automatically."
                : "Storage is not persistent. The browser may evict this data under pressure."}
          </p>
          {usage ? <p className="faint num">{usage}</p> : null}
          <button
            type="button"
            className="btn btn--block"
            onClick={() => void actions.requestPersist().then(setPersisted)}
          >
            Request persistent storage
          </button>
        </section>

        <section className="card stack">
          <h2 className="subtitle">Data</h2>
          <p className="label num">
            {store.transactions.length} transactions, {store.categories.length} categories,{" "}
            {store.recurrences.length} recurring
          </p>
          {store.damaged > 0 ? (
            <p className="notice notice--error">
              {store.damaged} records could not be decrypted.
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={() => setDialog("wipe")}
          >
            Delete all data
          </button>
        </section>

        <p className="faint num">
          Version {__APP_VERSION__}, built {__BUILD_DATE__}
        </p>
      </div>

      {dialog === "balance" ? (
        <AmountDialog
          title="Opening balance"
          description="The figure the ledger starts from. Changing it shifts every balance after the opening date."
          valueCents={settings.openingBalanceCents}
          allowNegative
          onClose={() => setDialog("none")}
          onSave={(cents) => actions.updateSettings({ openingBalanceCents: cents })}
        />
      ) : null}
      {dialog === "target" ? (
        <AmountDialog
          title="Monthly spending target"
          description="One number for the whole period. Set it to zero to switch the pace bar and the alerts off."
          valueCents={settings.monthlyTargetCents}
          onClose={() => setDialog("none")}
          onSave={(cents) => actions.updateSettings({ monthlyTargetCents: Math.max(0, cents) })}
        />
      ) : null}
      {dialog === "pin" ? <ChangePinDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "biometric" ? <EnrolBiometricDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "export" ? <ExportDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "import" ? <ImportDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "wipe" ? <WipeDialog onClose={() => setDialog("none")} /> : null}
    </main>
  );
}

function AmountDialog({
  title,
  description,
  valueCents,
  allowNegative = false,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  valueCents: number;
  allowNegative?: boolean;
  onClose: () => void;
  onSave: (cents: number) => Promise<void>;
}) {
  const [text, setText] = useState<string>(centsToDecimalString(valueCents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const cents = parseDecimalToCents(text);
    if (cents === null || (!allowNegative && cents < 0)) {
      setError("Enter an amount such as 1234,56.");
      return;
    }
    setBusy(true);
    try {
      await onSave(cents);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="faint">{description}</p>
      {error ? <p className="notice notice--error">{error}</p> : null}
      <div className="field">
        <label className="label" htmlFor="amount-dialog">
          Amount in EUR
        </label>
        <input
          id="amount-dialog"
          className="input num"
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

function ChangePinDialog({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [step, setStep] = useState<"old" | "new" | "confirm" | "done">("old");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (step === "old" && oldPin.length === PIN_LENGTH) setStep("new");
  }, [oldPin, step]);

  useEffect(() => {
    if (step === "new" && newPin.length === PIN_LENGTH) setStep("confirm");
  }, [newPin, step]);

  // Guarded by a ref so a re render cannot start a second rewrap.
  useEffect(() => {
    if (step !== "confirm" || confirmPin.length !== PIN_LENGTH || working.current) return;
    if (newPin !== confirmPin) {
      setError("The new entries did not match.");
      setNewPin("");
      setConfirmPin("");
      setStep("new");
      return;
    }
    working.current = true;
    void (async () => {
      try {
        await actions.changePin(oldPin, newPin);
        setStep("done");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The PIN was not changed.");
        setOldPin("");
        setNewPin("");
        setConfirmPin("");
        setStep("old");
      } finally {
        working.current = false;
      }
    })();
  }, [actions, confirmPin, newPin, oldPin, step]);

  return (
    <Dialog title="Change PIN" onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}
      {step === "old" ? <PinEntry pin={oldPin} onChange={setOldPin} label="Current PIN" /> : null}
      {step === "new" ? <PinEntry pin={newPin} onChange={setNewPin} label="New PIN" /> : null}
      {step === "confirm" ? (
        <PinEntry pin={confirmPin} onChange={setConfirmPin} label="Repeat the new PIN" />
      ) : null}
      {step === "done" ? (
        <div className="stack">
          <p className="muted">
            The PIN was changed. The records were not re encrypted, only the stored key was
            rewrapped.
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--block" onClick={onClose}>
          Cancel
        </button>
      )}
    </Dialog>
  );
}

function EnrolBiometricDialog({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await actions.enrolBiometric(pin);
        setMode(result);
      } catch (cause) {
        setPin("");
        setError(cause instanceof Error ? cause.message : "Enrolment did not complete.");
      } finally {
        working.current = false;
        setBusy(false);
      }
    })();
  }, [actions, pin]);

  return (
    <Dialog title="Biometric unlock" onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}
      {mode === null ? (
        <>
          <p className="muted">
            The PIN is needed once so the encryption key can be wrapped for the biometric path.
          </p>
          <PinEntry pin={pin} onChange={setPin} disabled={busy} label="Current PIN" />
        </>
      ) : (
        <>
          <p className="muted">{mode === "prf" ? PRF_EXPLANATION : GATE_EXPLANATION}</p>
          <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (passphrase.length < 8) {
      setError("Use a passphrase of at least 8 characters.");
      return;
    }
    if (passphrase !== confirm) {
      setError("The two passphrases do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDone(await actions.exportBackup(passphrase));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Export encrypted backup" onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}
      {done ? (
        <div className="stack">
          <p className="muted">
            Written to {done}. Keep the passphrase somewhere separate from the file. Without it the
            backup cannot be read.
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <p className="faint">
            The file is encrypted with AES-GCM under a key derived from this passphrase with
            PBKDF2-SHA256 at 600000 iterations.
          </p>
          <div className="field">
            <label className="label" htmlFor="export-pass">
              Passphrase
            </label>
            <input
              id="export-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="export-confirm">
              Repeat passphrase
            </label>
            <input
              id="export-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void run()}
              disabled={busy}
            >
              Export
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [text, setText] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!text) {
      setError("Choose a backup file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await actions.importBackup(text, passphrase, mode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Import backup" onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}
      {result !== null ? (
        <div className="stack">
          <p className="muted num">{result} records were imported.</p>
          <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="import-file">
              Backup file
            </label>
            <input
              id="import-file"
              className="input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFilename(file.name);
                void file.text().then(setText);
              }}
            />
            {filename ? <p className="faint">{filename}</p> : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="import-pass">
              Passphrase
            </label>
            <input
              id="import-pass"
              className="input"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Existing data</span>
            <div className="segmented" role="group" aria-label="Import mode">
              <button
                type="button"
                aria-pressed={mode === "merge"}
                onClick={() => setMode("merge")}
              >
                Merge by id
              </button>
              <button
                type="button"
                aria-pressed={mode === "replace"}
                onClick={() => setMode("replace")}
              >
                Replace all
              </button>
            </div>
            <p className="faint">
              {mode === "merge"
                ? "Records in the file overwrite records with the same id. Everything else is kept."
                : "Every record on this device is deleted first, then the file is restored."}
            </p>
          </div>

          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void run()}
              disabled={busy}
            >
              Import
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function WipeDialog({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog title="Delete all data" onClose={onClose}>
      <p className="notice notice--error">
        This deletes every transaction, every category and the encryption key on this device. It
        cannot be undone. Only an exported backup can restore the data.
      </p>
      <div className="field">
        <label className="label" htmlFor="wipe-confirm">
          Type DELETE to confirm
        </label>
        <input
          id="wipe-confirm"
          className="input"
          type="text"
          autoCapitalize="characters"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={typed.trim() !== "DELETE" || busy}
          onClick={() => {
            setBusy(true);
            void actions.wipeAll();
          }}
        >
          Delete everything
        </button>
      </div>
    </Dialog>
  );
}
