import { useMemo, useState, type CSSProperties } from "react";
import { Dialog } from "../components/Dialog.tsx";
import { groupByDay } from "../lib/budget.ts";
import { centsToDecimalString, formatCents, formatCentsSigned, parseDecimalToCents } from "../lib/money.ts";
import {
  currentPeriod,
  formatDayHeading,
  formatMonthLabel,
  periodContains,
  shiftPeriod,
  today,
} from "../lib/period.ts";
import { useActions, useStoreState } from "../state/store.tsx";
import type { Transaction } from "../lib/types.ts";

/** Inline colour only when the category still exists, the CSS carries the fallback. */
function colourOf(colour: string | undefined): CSSProperties | undefined {
  return colour ? { background: colour } : undefined;
}

export function TransactionsView() {
  const store = useStoreState();
  const { locale, monthStartDay } = store.settings;
  const [offset, setOffset] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const period = useMemo(() => {
    const base = currentPeriod(monthStartDay);
    return offset === 0 ? base : shiftPeriod(base, offset);
  }, [monthStartDay, offset]);

  const names = useMemo(
    () => new Map(store.categories.map((category) => [category.id, category])),
    [store.categories],
  );

  const filtered = useMemo(
    () =>
      store.transactions.filter(
        (row) =>
          periodContains(period, row.date) &&
          (categoryFilter === "all" || row.categoryId === categoryFilter),
      ),
    [categoryFilter, period, store.transactions],
  );

  const runningTotal = filtered.reduce((sum, row) => sum + row.amountCents, 0);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <main className="screen">
      <div className="stack">
        <div className="row-between">
          <button type="button" className="btn" onClick={() => setOffset(offset - 1)}>
            Back
          </button>
          <h1 className="subtitle">{formatMonthLabel(period, locale)}</h1>
          <button
            type="button"
            className="btn"
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          >
            Next
          </button>
        </div>

        <div className="field">
          <label className="label" htmlFor="filter-category">
            Category
          </label>
          <select
            id="filter-category"
            className="select"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {store.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <section className="card row-between">
          <span className="label">Total for this filter</span>
          <span className={runningTotal < 0 ? "subtitle num negative" : "subtitle num positive"}>
            {formatCentsSigned(runningTotal, locale)}
          </span>
        </section>

        {groups.length === 0 ? <p className="muted">No transactions in this period.</p> : null}

        {groups.map((group) => (
          <section className="day-group" key={group.date}>
            <div className="day-head">
              <span>{formatDayHeading(group.date, locale)}</span>
              <span className="num">{formatCentsSigned(group.totalCents, locale)}</span>
            </div>
            <ul className="list">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <button type="button" className="list-item" onClick={() => setEditing(row)}>
                    <div className="row-between">
                      <span className="with-swatch">
                        <span
                          className="swatch"
                          style={colourOf(names.get(row.categoryId)?.colour)}
                          aria-hidden="true"
                        />
                        <span>{names.get(row.categoryId)?.name ?? "Unknown category"}</span>
                      </span>
                      <span className={row.amountCents < 0 ? "num" : "num positive"}>
                        {formatCents(row.amountCents, locale)}
                      </span>
                    </div>
                    {row.note ? <p className="faint">{row.note}</p> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {editing ? (
        <EditTransactionDialog transaction={editing} onClose={() => setEditing(null)} />
      ) : null}
    </main>
  );
}

function EditTransactionDialog({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const store = useStoreState();
  const actions = useActions();
  const [amountText, setAmountText] = useState<string>(
    centsToDecimalString(Math.abs(transaction.amountCents)),
  );
  const [direction, setDirection] = useState(transaction.amountCents < 0 ? "expense" : "income");
  const [date, setDate] = useState(transaction.date);
  const [categoryId, setCategoryId] = useState(transaction.categoryId);
  const [note, setNote] = useState(transaction.note);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const cents = parseDecimalToCents(amountText);
    if (cents === null || cents <= 0) {
      setError("Enter an amount such as 12,34.");
      return;
    }
    setBusy(true);
    try {
      await actions.updateTransaction({
        ...transaction,
        date,
        categoryId,
        note: note.trim(),
        amountCents: direction === "expense" ? -cents : cents,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await actions.deleteTransaction(transaction.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Edit transaction" onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}

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
        <label className="label" htmlFor="edit-amount">
          Amount in EUR
        </label>
        <input
          id="edit-amount"
          className="input num"
          type="text"
          inputMode="decimal"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="edit-category">
          Category
        </label>
        <select
          id="edit-category"
          className="select"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {store.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="edit-date">
          Date
        </label>
        <input
          id="edit-date"
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(event) => setDate(event.target.value || transaction.date)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="edit-note">
          Note
        </label>
        <input
          id="edit-note"
          className="input"
          type="text"
          value={note}
          maxLength={120}
          onChange={(event) => setNote(event.target.value)}
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

      {confirmDelete ? (
        <div className="notice notice--error">
          <span>Delete this transaction? This cannot be undone.</span>
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
        <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirmDelete(true)}>
          Delete transaction
        </button>
      )}
    </Dialog>
  );
}
