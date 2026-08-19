import { useMemo, useState } from "react";
import { Dialog } from "../components/Dialog.tsx";
import { centsToDecimalString, formatCents, parseDecimalToCents } from "../lib/money.ts";
import { formatShortDate, today } from "../lib/period.ts";
import { describeInterval, nextDueDate } from "../lib/recurrence.ts";
import { useActions, useStoreState } from "../state/store.tsx";
import type { Recurrence, RecurrenceInterval } from "../lib/types.ts";
import type { Route } from "../router.ts";

export function RecurringView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const store = useStoreState();
  const { locale } = store.settings;
  const [editing, setEditing] = useState<Recurrence | null>(null);
  const [adding, setAdding] = useState(false);
  const todayIso = today();

  const names = useMemo(
    () => new Map(store.categories.map((category) => [category.id, category])),
    [store.categories],
  );

  return (
    <main className="screen">
      <div className="stack">
        <div className="row-between">
          <button type="button" className="btn" onClick={() => onNavigate("settings")}>
            Back
          </button>
          <h1 className="subtitle">Recurring</h1>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            Add
          </button>
        </div>

        <p className="faint">
          Each one posts itself as a normal transaction when it falls due, including any dates
          that passed while the app was closed. Posted rows can be edited or deleted like any
          other.
        </p>

        {store.recurrences.length === 0 ? (
          <p className="muted">Nothing set up yet.</p>
        ) : (
          <ul className="list">
            {store.recurrences.map((row) => {
              const due = nextDueDate(row, todayIso);
              return (
                <li key={row.id}>
                  <button type="button" className="list-item" onClick={() => setEditing(row)}>
                    <div className="row-between">
                      <span className="with-swatch">
                        <span
                          className="swatch"
                          style={{ background: names.get(row.categoryId)?.colour ?? undefined }}
                          aria-hidden="true"
                        />
                        <span>{row.name}</span>
                      </span>
                      <span className={row.amountCents < 0 ? "num" : "num positive"}>
                        {formatCents(row.amountCents, locale)}
                      </span>
                    </div>
                    <p className="faint">
                      {describeInterval(row)}
                      {row.active
                        ? due
                          ? `, next on ${formatShortDate(due, locale)}`
                          : ", finished"
                        : ", paused"}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing ? <RecurrenceDialog recurrence={editing} onClose={() => setEditing(null)} /> : null}
      {adding ? <RecurrenceDialog recurrence={null} onClose={() => setAdding(false)} /> : null}
    </main>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function RecurrenceDialog({
  recurrence,
  onClose,
}: {
  recurrence: Recurrence | null;
  onClose: () => void;
}) {
  const store = useStoreState();
  const actions = useActions();
  const active = store.categories.filter((category) => !category.archived);

  const [name, setName] = useState(recurrence?.name ?? "");
  const [amountText, setAmountText] = useState<string>(
    centsToDecimalString(Math.abs(recurrence?.amountCents ?? 0)),
  );
  const [direction, setDirection] = useState<"expense" | "income">(
    (recurrence?.amountCents ?? -1) < 0 ? "expense" : "income",
  );
  const [categoryId, setCategoryId] = useState(recurrence?.categoryId ?? active[0]?.id ?? "");
  const [interval, setInterval] = useState<RecurrenceInterval>(recurrence?.interval ?? "monthly");
  const [dayOfMonth, setDayOfMonth] = useState(recurrence?.dayOfMonth ?? 1);
  const [weekday, setWeekday] = useState(recurrence?.weekday ?? 1);
  const [month, setMonth] = useState(recurrence?.month ?? 1);
  const [startDate, setStartDate] = useState(recurrence?.startDate ?? today());
  const [endDate, setEndDate] = useState(recurrence?.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Enter a name, for example the name of the subscription.");
      return;
    }
    const cents = parseDecimalToCents(amountText);
    if (cents === null || cents <= 0) {
      setError("Enter an amount such as 9,99.");
      return;
    }
    if (categoryId === "") {
      setError("Choose a category.");
      return;
    }
    setBusy(true);
    try {
      const shape = {
        name: trimmed,
        amountCents: direction === "expense" ? -cents : cents,
        categoryId,
        interval,
        dayOfMonth,
        weekday,
        month,
        startDate,
        endDate: endDate === "" ? null : endDate,
        active: recurrence?.active ?? true,
      };
      if (recurrence) await actions.updateRecurrence({ ...recurrence, ...shape });
      else await actions.addRecurrence(shape);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function togglePaused() {
    if (!recurrence) return;
    setBusy(true);
    try {
      await actions.updateRecurrence({ ...recurrence, active: !recurrence.active });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!recurrence) return;
    setBusy(true);
    try {
      await actions.deleteRecurrence(recurrence.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={recurrence ? "Edit recurring payment" : "New recurring payment"} onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}

      <div className="field">
        <label className="label" htmlFor="rec-name">
          Name
        </label>
        <input
          id="rec-name"
          className="input"
          type="text"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

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

      <div className="field">
        <label className="label" htmlFor="rec-amount">
          Amount in EUR
        </label>
        <input
          id="rec-amount"
          className="input num"
          type="text"
          inputMode="decimal"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="rec-category">
          Category
        </label>
        <select
          id="rec-category"
          className="select"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {active.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="rec-interval">
          Repeats
        </label>
        <select
          id="rec-interval"
          className="select"
          value={interval}
          onChange={(event) => setInterval(event.target.value as RecurrenceInterval)}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>

      {interval === "weekly" ? (
        <div className="field">
          <label className="label" htmlFor="rec-weekday">
            Day of the week
          </label>
          <select
            id="rec-weekday"
            className="select"
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor="rec-day">
            Day of the month
          </label>
          <select
            id="rec-day"
            className="select num"
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(Number(event.target.value))}
          >
            {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <p className="faint">
            Capped at 28 so every month has the date.
          </p>
        </div>
      )}

      {interval === "yearly" ? (
        <div className="field">
          <label className="label" htmlFor="rec-month">
            Month
          </label>
          <select
            id="rec-month"
            className="select"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
          >
            {MONTHS.map((name_, index) => (
              <option key={name_} value={index + 1}>
                {name_}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="rec-start">
          First payment on or after
        </label>
        <input
          id="rec-start"
          className="input"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value || today())}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="rec-end">
          Stop after, optional
        </label>
        <input
          id="rec-end"
          className="input"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
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

      {recurrence ? (
        <>
          <button
            type="button"
            className="btn btn--block"
            onClick={() => void togglePaused()}
            disabled={busy}
          >
            {recurrence.active ? "Pause" : "Resume"}
          </button>
          {confirmDelete ? (
            <div className="notice notice--error">
              <span>
                Delete this recurring payment? Transactions it already posted are kept.
              </span>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => void remove()}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
