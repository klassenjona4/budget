import { useMemo, useState } from "react";
import { ProgressBar } from "../components/ProgressBar.tsx";
import { summarise } from "../lib/budget.ts";
import { daysSinceExport, EXPORT_REMINDER_DAYS } from "../lib/backup.ts";
import { formatCents, formatCentsAbs } from "../lib/money.ts";
import {
  currentPeriod,
  formatMonthLabel,
  formatPeriodRange,
  isCurrentPeriod,
  shiftPeriod,
} from "../lib/period.ts";
import { useStoreState } from "../state/store.tsx";
import type { Route } from "../router.ts";

export function OverviewView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const store = useStoreState();
  const { locale, monthStartDay } = store.settings;
  const [offset, setOffset] = useState(0);

  const period = useMemo(() => {
    const base = currentPeriod(monthStartDay);
    return offset === 0 ? base : shiftPeriod(base, offset);
  }, [monthStartDay, offset]);

  const summary = useMemo(
    () => summarise(store.categories, store.transactions, period),
    [period, store.categories, store.transactions],
  );

  const sinceExport = daysSinceExport(store.settings.lastExportAt);
  const backupDue = sinceExport === null || sinceExport >= EXPORT_REMINDER_DAYS;

  return (
    <main className="screen">
      <div className="stack">
        <div className="row-between">
          <button
            type="button"
            className="btn"
            aria-label="Previous period"
            onClick={() => setOffset(offset - 1)}
          >
            Back
          </button>
          <div className="text-centre">
            <h1 className="subtitle">{formatMonthLabel(period, locale)}</h1>
            <p className="faint num">{formatPeriodRange(period, locale)}</p>
          </div>
          <button
            type="button"
            className="btn"
            aria-label="Next period"
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          >
            Next
          </button>
        </div>

        {backupDue ? (
          <div className="notice">
            <span>
              {sinceExport === null
                ? "No encrypted backup has been exported yet. Removing the app from the home screen deletes all data."
                : `The last encrypted backup is ${sinceExport} days old.`}
            </span>
            <button type="button" className="btn" onClick={() => onNavigate("settings")}>
              Go to backup
            </button>
          </div>
        ) : null}

        {store.damaged > 0 ? (
          <p className="notice notice--error">
            {store.damaged} records could not be decrypted and are not shown.
          </p>
        ) : null}

        <section className="card">
          <div className="figures">
            <div>
              <p className="label">Planned</p>
              <p className="figure num">{formatCentsAbs(summary.plannedCents, locale)}</p>
            </div>
            <div>
              <p className="label">Spent</p>
              <p className="figure num">{formatCentsAbs(summary.spentCents, locale)}</p>
            </div>
            <div>
              <p className="label">Remaining</p>
              <p
                className={
                  summary.remainingCents < 0 ? "figure num negative" : "figure num positive"
                }
              >
                {formatCentsAbs(summary.remainingCents, locale)}
              </p>
            </div>
          </div>
        </section>

        <section className="card stack stack--tight">
          <div className="row-between">
            <span className="label">Per day for the rest of the period</span>
            <span
              className={summary.perDayCents < 0 ? "subtitle num negative" : "subtitle num"}
            >
              {formatCents(summary.perDayCents, locale)}
            </span>
          </div>
          <p className="faint">
            {isCurrentPeriod(period)
              ? `${summary.daysLeft} days left, variable categories only.`
              : "Variable categories only."}
          </p>
          {summary.incomeCents > 0 ? (
            <div className="row-between">
              <span className="label">Income in this period</span>
              <span className="num positive">{formatCentsAbs(summary.incomeCents, locale)}</span>
            </div>
          ) : null}
        </section>

        <section className="stack stack--tight">
          <h2 className="label">Categories</h2>
          <ul className="list">
            {summary.categories.map((row) => {
              const over = row.remainingCents < 0;
              return (
                <li key={row.category.id}>
                  <div className={over ? "list-item list-item--over" : "list-item"}>
                    <div className="row-between">
                      <span className="with-swatch">
                        <span
                          className="swatch"
                          style={{ background: row.category.colour }}
                          aria-hidden="true"
                        />
                        <span>{row.category.name}</span>
                      </span>
                      <span className="num">
                        {formatCentsAbs(row.spentCents, locale)} of{" "}
                        {formatCentsAbs(row.plannedCents, locale)}
                      </span>
                    </div>
                    <div className="spaced">
                      <ProgressBar
                        spentCents={row.spentCents}
                        plannedCents={row.plannedCents}
                      />
                    </div>
                    <div className="row-between spaced">
                      <span className="faint">
                        {row.category.kind === "fixed" ? "Fixed" : "Variable"}
                        {row.category.archived ? ", archived" : ""}
                      </span>
                      <span className={over ? "num negative" : "num muted"}>
                        {over
                          ? `${formatCentsAbs(-row.remainingCents, locale)} over`
                          : `${formatCentsAbs(row.remainingCents, locale)} left`}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
