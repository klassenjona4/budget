import { useEffect, useMemo, useState } from "react";
import { Keypad } from "../components/Keypad.tsx";
import { recentCategoryIds } from "../lib/insights.ts";
import { digitsToCents, formatDigits } from "../lib/money.ts";
import { today } from "../lib/period.ts";
import { useActions, useStoreState } from "../state/store.tsx";
import type { Route } from "../router.ts";

type Direction = "expense" | "income";

export function AddTransactionView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const store = useStoreState();
  const actions = useActions();
  const { locale } = store.settings;
  const [digits, setDigits] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
  const [categoryId, setCategoryId] = useState<string>("");
  const [date, setDate] = useState<string>(today());
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const available = useMemo(
    () => store.categories.filter((category) => !category.archived),
    [store.categories],
  );

  const ordered = useMemo(() => {
    const recent = recentCategoryIds(store.transactions, available.length);
    const byId = new Map(available.map((category) => [category.id, category]));
    const head = recent.flatMap((id) => {
      const category = byId.get(id);
      return category ? [category] : [];
    });
    const tail = available.filter((category) => !recent.includes(category.id));
    return [...head, ...tail];
  }, [available, store.transactions]);

  useEffect(() => {
    if (categoryId === "" && ordered.length > 0) setCategoryId(ordered[0]?.id ?? "");
  }, [categoryId, ordered]);

  const cents = digitsToCents(digits);
  const canSave = cents > 0 && categoryId !== "" && !busy;

  async function save(again: boolean) {
    if (!canSave) return;
    setBusy(true);
    try {
      await actions.addTransaction({
        date,
        amountCents: direction === "expense" ? -cents : cents,
        categoryId,
        note: note.trim(),
      });
      setDigits("");
      setNote("");
      if (again) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      } else {
        onNavigate("home");
      }
    } finally {
      setBusy(false);
    }
  }

  if (available.length === 0) {
    return (
      <main className="screen">
        <div className="stack">
          <h1 className="title">Add</h1>
          <p className="muted">There are no active categories. Add one first.</p>
          <button type="button" className="btn btn--primary" onClick={() => onNavigate("categories")}>
            Go to categories
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="stack">
        <p
          className={direction === "expense" ? "amount-display" : "amount-display positive"}
          aria-label="Amount"
        >
          {direction === "expense" ? "-" : "+"}
          {formatDigits(digits, locale)}
        </p>

        <div className="segmented" role="group" aria-label="Direction">
          <button
            type="button"
            aria-pressed={direction === "expense"}
            onClick={() => setDirection("expense")}
          >
            Expense
          </button>
          <button
            type="button"
            aria-pressed={direction === "income"}
            onClick={() => setDirection("income")}
          >
            Income
          </button>
        </div>

        <Keypad
          onDigit={(digit) => setDigits((current) => (current + digit).slice(0, 9))}
          onBackspace={() => setDigits((current) => current.slice(0, -1))}
          extraKey={{ label: "00", onPress: () => setDigits((current) => (current === "" ? "" : `${current}00`).slice(0, 9)) }}
        />

        <div className="stack stack--tight">
          <h2 className="label">Category</h2>
          <div className="chip-grid">
            {ordered.map((category) => (
              <button
                key={category.id}
                type="button"
                className="chip"
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="swatch" style={{ background: category.colour }} aria-hidden="true" />
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="add-date">
            Date
          </label>
          <input
            id="add-date"
            className="input"
            type="date"
            value={date}
            max={today()}
            onChange={(event) => setDate(event.target.value || today())}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="add-note">
            Note
          </label>
          <input
            id="add-note"
            className="input"
            type="text"
            value={note}
            maxLength={120}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {saved ? <p className="notice">Saved.</p> : null}

        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSave}
            onClick={() => void save(false)}
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canSave}
            onClick={() => void save(true)}
          >
            Save and add another
          </button>
        </div>
      </div>
    </main>
  );
}
