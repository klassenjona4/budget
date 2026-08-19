import { useEffect, useRef, useState } from "react";
import { PIN_LENGTH, PinEntry } from "../components/PinEntry.tsx";
import { useActions, useStoreState } from "../state/store.tsx";
import type { BiometricMode } from "../lib/vault.ts";

type Step = "pin" | "confirm" | "creating" | "biometric" | "enrolled";

const GATE_EXPLANATION =
  "This device did not provide key material, so the app uses gate mode. The encryption key is stored on the device and the biometric check locks the interface rather than the data. The protection then rests on the phone lock screen. The PIN path stays fully encrypted.";

const PRF_EXPLANATION =
  "This device provided key material, so the biometric is part of the encryption key. The data cannot be read without it.";

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { biometricAvailable } = useStoreState();
  const actions = useActions();
  const [step, setStep] = useState<Step>("pin");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<BiometricMode | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);

  useEffect(() => {
    if (step === "pin" && first.length === PIN_LENGTH) {
      setStep("confirm");
      setError(null);
    }
  }, [first, step]);

  useEffect(() => {
    if (step !== "confirm" || second.length !== PIN_LENGTH) return;
    if (first !== second) {
      setError("The two entries did not match. Start again.");
      setFirst("");
      setSecond("");
      setStep("pin");
      return;
    }
    setStep("creating");
  }, [first, second, step]);

  // Creating the vault must happen exactly once, whatever else re renders.
  useEffect(() => {
    if (step !== "creating" || creating.current) return;
    creating.current = true;
    void (async () => {
      try {
        await actions.setup(first);
        if (biometricAvailable) setStep("biometric");
        else onDone();
      } catch (cause) {
        creating.current = false;
        setError(cause instanceof Error ? cause.message : "Setup failed.");
        setStep("pin");
        setFirst("");
        setSecond("");
      }
    })();
  }, [actions, biometricAvailable, first, onDone, step]);

  async function enrol() {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.enrolBiometric(first);
      setMode(result);
      setStep("enrolled");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Enrolment did not complete. ${cause.message}`
          : "Enrolment did not complete.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--plain">
      <div className="centre">
        <div className="stack stack--tight">
          <h1 className="title">Set up Budget</h1>
          <p className="muted">
            All data stays on this device, encrypted. There is no account and no server.
          </p>
        </div>

        {error ? <p className="notice notice--error">{error}</p> : null}

        {step === "pin" ? (
          <PinEntry pin={first} onChange={setFirst} label="Choose a 6 digit PIN" />
        ) : null}

        {step === "confirm" ? (
          <div className="stack">
            <PinEntry pin={second} onChange={setSecond} label="Enter the PIN again" />
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setFirst("");
                setSecond("");
                setStep("pin");
              }}
            >
              Start again
            </button>
          </div>
        ) : null}

        {step === "creating" ? <p className="muted">Creating the encrypted vault.</p> : null}

        {step === "biometric" ? (
          <div className="stack">
            <p className="muted">
              Unlock with Face ID, Touch ID or a fingerprint instead of typing the PIN. The PIN
              always stays available as a fallback.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={busy}
              onClick={() => void enrol()}
            >
              Set up biometric unlock
            </button>
            <button type="button" className="btn btn--block" disabled={busy} onClick={onDone}>
              Continue with the PIN only
            </button>
          </div>
        ) : null}

        {step === "enrolled" ? (
          <div className="stack">
            <p className="muted">{mode === "prf" ? PRF_EXPLANATION : GATE_EXPLANATION}</p>
            <button type="button" className="btn btn--primary btn--block" onClick={onDone}>
              Continue
            </button>
          </div>
        ) : null}

        <p className="faint">
          A forgotten PIN cannot be recovered. Export an encrypted backup once the app is set up.
        </p>
      </div>
    </main>
  );
}
