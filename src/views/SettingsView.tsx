import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/Dialog.tsx";
import { PIN_LENGTH, PinEntry } from "../components/PinEntry.tsx";
import { Switch } from "../components/Switch.tsx";
import { isStoragePersisted, storageEstimate } from "../lib/db.ts";
import { useActions, useStoreState, type ImportMode } from "../state/store.tsx";
import type { Locale } from "../lib/types.ts";

const GATE_EXPLANATION =
  "Mode: gate. The device did not provide key material, so the encryption key is stored on this device and the biometric check is a lock on the interface rather than on the data. The protection rests on the phone lock screen. The PIN path is unaffected and remains fully encrypted.";

const PRF_EXPLANATION =
  "Mode: prf. The device provided key material, so the biometric is required to reconstruct the encryption key. The data cannot be decrypted without it.";

const AUTO_LOCK_CHOICES = [30, 60, 120, 300, 600, 900];

export function SettingsView() {
  const store = useStoreState();
  const actions = useActions();
  const settings = store.settings;
  const [dialog, setDialog] = useState<
    "none" | "pin" | "biometric" | "export" | "import" | "wipe"
  >("none");
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string>("");

  useEffect(() => {
    void (async () => {
      setPersisted(await isStoragePersisted());
      const estimate = await storageEstimate();
      if (estimate) {
        setUsage(`${Math.round(estimate.usage / 1024)} kB used of the browser quota`);
      }
    })();
  }, []);

  return (
    <main className="screen">
      <div className="stack">
        <h1 className="title">Settings</h1>

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
            {store.transactions.length} transactions, {store.categories.length} categories
          </p>
          {store.damaged > 0 ? (
            <p className="notice notice--error">
              {store.damaged} records could not be decrypted.
            </p>
          ) : null}
          <button type="button" className="btn btn--danger btn--block" onClick={() => setDialog("wipe")}>
            Delete all data
          </button>
        </section>

        <p className="faint num">
          Version {__APP_VERSION__}, built {__BUILD_DATE__}
        </p>
      </div>

      {dialog === "pin" ? <ChangePinDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "biometric" ? <EnrolBiometricDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "export" ? <ExportDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "import" ? <ImportDialog onClose={() => setDialog("none")} /> : null}
      {dialog === "wipe" ? <WipeDialog onClose={() => setDialog("none")} /> : null}
    </main>
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
