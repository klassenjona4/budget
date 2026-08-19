import { useMemo, useState } from "react";
import { BalanceChart } from "../components/BalanceChart.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { balanceSeries, currentBalance, seriesChange } from "../lib/balance.ts";
import { daysSinceExport, EXPORT_REMINDER_DAYS } from "../lib/backup.ts";
import {
  averageDailySpend,
  spentOn,
  summariseMonth,
  type MonthInsight,
} from "../lib/insights.ts";
import {
  centsToDecimalString,
  divFloor,
  formatCents,
  formatCentsAbs,
  formatCentsSigned,
  parseDecimalToCents,
} from "../lib/money.ts";
import { currentPeriod, formatShortDate, today } from "../lib/period.ts";
import { nextDueDate } from "../lib/recurrence.ts";
import { useActions, useStoreState } from "../state/store.tsx";
import type { Route } from "../router.ts";

const BALANCE_DAYS = 30;

export function HomeView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const store = useStoreState();
  const actions = useActions();
  const { locale, monthStartDay } = store.settings;
  const [correcting, setCorrecting] = useState(false);
  const todayIso = today();

  const balanceCents = useMemo(
    () => currentBalance(store.settings, store.transactions, todayIso),
    [store.settings, store.transactions, todayIso],
  );

  const series = useMemo(
    () => balanceSeries(store.settings, store.transactions, BALANCE_DAYS, todayIso),
    [store.settings, store.transactions, todayIso],
  );

  const insight = useMemo(
    () =>
      summariseMonth(
        store.categories,
        store.transactions,
        currentPeriod(monthStartDay),
        store.settings,
      ),
    [monthStartDay, store.categories, store.settings, store.transactions],
  );

  const upcoming = useMemo(() => {
    const horizon = series[series.length - 1]?.date ?? todayIso;
    void horizon;
    return store.recurrences
      .filter((row) => row.active)
      .map((row) => ({ recurrence: row, due: nextDueDate(row, todayIso) }))
      .filter((row): row is { recurrence: (typeof store.recurrences)[number]; due: string } =>
        row.due !== null,
      )
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 3);
  }, [series, store.recurrences, todayIso]);

  const recent = store.transactions.slice(0, 5);
  const names = useMemo(
    () => new Map(store.categories.map((category) => [category.id, category])),
    [store.categories],
  );

  const beforeOpening = useMemo(
    () => store.transactions.filter((row) => row.date < store.settings.openingBalanceDate).length,
    [store.settings.openingBalanceDate, store.transactions],
  );

  const sinceExport = daysSinceExport(store.settings.lastExportAt);
  const backupDue = sinceExport === null || sinceExport >= EXPORT_REMINDER_DAYS;
  const change = seriesChange(series);

  return (
    <main className="screen">
      <div className="stack">
        <section className="card stack stack--tight">
          <div className="row-between">
            <span className="label">Balance today</span>
            <button type="button" className="btn btn--quiet" onClick={() => setCorrecting(true)}>
              Correct
            </button>
          </div>
          <p className={balanceCents < 0 ? "figure num negative" : "figure num"}>
            {formatCents(balanceCents, locale)}
          </p>
          <BalanceChart points={series} locale={locale} />
          <p className="faint num">
            {change === 0
              ? `Unchanged over ${BALANCE_DAYS} days`
              : `${formatCentsSigned(change, locale)} over ${BALANCE_DAYS} days`}
          </p>
        </section>

        <NoticeCards insight={insight} onNavigate={onNavigate} />

        <section className="card stack stack--tight">
          <div className="row-between">
            <span className="label">This month</span>
            <button type="button" className="btn btn--quiet" onClick={() => onNavigate("review")}>
              Review
            </button>
          </div>
          <div className="figures">
            <div>
              <p className="label">Spent</p>
              <p className="figure num">{formatCentsAbs(insight.spentCents, locale)}</p>
            </div>
            <div>
              <p className="label">Received</p>
              <p className="figure num positive">{formatCentsAbs(insight.receivedCents, locale)}</p>
            </div>
            <div>
              <p className="label">Net</p>
              <p className={insight.netCents < 0 ? "figure num negative" : "figure num positive"}>
                {formatCentsSigned(insight.netCents, locale)}
              </p>
            </div>
          </div>
          <PaceBar insight={insight} />
        </section>

        {upcoming.length > 0 ? (
          <section className="card stack stack--tight">
            <div className="row-between">
              <span className="label">Coming up</span>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => onNavigate("recurring")}
              >
                Manage
              </button>
            </div>
            <ul className="list">
              {upcoming.map(({ recurrence, due }) => (
                <li key={recurrence.id} className="row-between">
                  <span className="with-swatch">
                    <span
                      className="swatch"
                      style={{ background: names.get(recurrence.categoryId)?.colour ?? undefined }}
                      aria-hidden="true"
                    />
                    <span>{recurrence.name}</span>
                  </span>
                  <span className="num faint">{formatShortDate(due, locale)}</span>
                  <span className={recurrence.amountCents < 0 ? "num" : "num positive"}>
                    {formatCents(recurrence.amountCents, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {store.postedThisSession > 0 ? (
          <p className="notice">
            {store.postedThisSession} recurring{" "}
            {store.postedThisSession === 1 ? "payment was" : "payments were"} posted since the last
            time the app was open.
          </p>
        ) : null}

        {beforeOpening > 0 ? (
          <p className="notice">
            {beforeOpening} {beforeOpening === 1 ? "entry is" : "entries are"} dated before the
            opening balance. They appear in the review but do not move the balance, because the
            opening figure already covers that time.
          </p>
        ) : null}

        {backupDue ? (
          <div className="notice">
            <span>
              {sinceExport === null
                ? "No encrypted backup has been exported yet. Removing the app deletes all data."
                : `The last encrypted backup is ${sinceExport} days old.`}
            </span>
            <button type="button" className="btn" onClick={() => onNavigate("settings")}>
              Go to backup
            </button>
          </div>
        ) : null}

        <section className="stack stack--tight">
          <div className="row-between">
            <h2 className="label">Recent</h2>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => onNavigate("transactions")}
            >
              All transactions
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="muted">Nothing recorded yet.</p>
          ) : (
            <ul className="list">
              {recent.map((row) => (
                <li key={row.id}>
                  <div className="list-item">
                    <div className="row-between">
                      <span className="with-swatch">
                        <span
                          className="swatch"
                          style={{ background: names.get(row.categoryId)?.colour ?? undefined }}
                          aria-hidden="true"
                        />
                        <span>{names.get(row.categoryId)?.name ?? "Unknown category"}</span>
                      </span>
                      <span className={row.amountCents < 0 ? "num" : "num positive"}>
                        {formatCents(row.amountCents, locale)}
                      </span>
                    </div>
                    <p className="faint num">
                      {formatShortDate(row.date, locale)}
                      {row.note ? `, ${row.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {correcting ? (
        <CorrectBalanceDialog
          balanceCents={balanceCents}
          onClose={() => setCorrecting(false)}
          onSubmit={actions.correctBalance}
        />
      ) : null}
    </main>
  );
}

function PaceBar({ insight }: { insight: MonthInsight }) {
  const store = useStoreState();
  const { locale } = store.settings;
  if (insight.targetCents <= 0) {
    return (
      <p className="faint">
        No monthly target set. Settings, Money, Monthly spending target.
      </p>
    );
  }

  const percent = Math.min(
    100,
    Math.round((Math.min(insight.spentCents, insight.targetCents) * 100) / insight.targetCents),
  );
  const allowedPercent = Math.min(
    100,
    Math.round((insight.allowedSoFarCents * 100) / insight.targetCents),
  );
  const over = insight.spentCents > insight.targetCents;

  const wording =
    insight.status === "over"
      ? "Ahead of the pace your target allows"
      : insight.status === "under"
        ? "Behind the pace your target allows, in the good direction"
        : "On pace with your target";

  return (
    <div className="stack stack--tight">
      <div className={over ? "progress progress--over pace" : "progress pace"}>
        <span style={{ width: `${percent}%` }} />
        <i className="pace__marker" style={{ left: `${allowedPercent}%` }} aria-hidden="true" />
      </div>
      <div className="row-between">
        <span className="faint">{wording}</span>
        <span className="num faint">
          {formatCentsAbs(insight.spentCents, locale)} of {formatCentsAbs(insight.targetCents, locale)}
        </span>
      </div>
    </div>
  );
}

/**
 * The morning starter and the evening recap. Shown in the app whenever the
 * window has been reached and the card has not been dismissed today, which is
 * the part that works with no permissions and no background wake up.
 */
function NoticeCards({
  insight,
  onNavigate,
}: {
  insight: MonthInsight;
  onNavigate: (route: Route) => void;
}) {
  const store = useStoreState();
  const actions = useActions();
  const { locale, notifications } = store.settings;
  const now = new Date();
  const hour = now.getHours();
  const todayIso = today();

  const showMorning =
    hour >= notifications.morningHour && hour < 12 && store.settings.lastMorningNotice !== todayIso;
  const showEvening =
    hour >= notifications.eveningHour && store.settings.lastEveningNotice !== todayIso;

  if (showEvening) {
    const spentToday = spentOn(store.transactions, todayIso);
    const average = averageDailySpend(store.transactions, 7, todayIso);
    return (
      <section className="card stack stack--tight">
        <div className="row-between">
          <span className="label">Evening recap</span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => void actions.markNoticeShown("evening")}
          >
            Dismiss
          </button>
        </div>
        <p className="subtitle num">{formatCentsAbs(spentToday, locale)} today</p>
        <p className="faint">
          {average > 0
            ? `Your average over the last seven days is ${formatCentsAbs(average, locale)} a day.`
            : "No spending recorded in the last seven days."}
        </p>
        <p className="faint">
          {insight.targetCents > 0
            ? `This month: ${formatCentsAbs(insight.spentCents, locale)} of ${formatCentsAbs(insight.targetCents, locale)}.`
            : `This month: ${formatCentsAbs(insight.spentCents, locale)}.`}
        </p>
        <button type="button" className="btn" onClick={() => onNavigate("review")}>
          See the month
        </button>
      </section>
    );
  }

  if (showMorning) {
    const daysLeft = Math.max(1, insight.daysTotal - insight.daysElapsed + 1);
    const remaining = insight.targetCents - insight.spentCents;
    const allowance = insight.targetCents > 0 ? divFloor(remaining, daysLeft) : 0;
    return (
      <section className="card stack stack--tight">
        <div className="row-between">
          <span className="label">Daily starter</span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => void actions.markNoticeShown("morning")}
          >
            Dismiss
          </button>
        </div>
        {insight.targetCents > 0 ? (
          <>
            <p className={allowance < 0 ? "subtitle num negative" : "subtitle num"}>
              {formatCents(allowance, locale)} a day
            </p>
            <p className="faint">
              {allowance < 0
                ? `You are over the target with ${daysLeft} days left in the period.`
                : `That is what is left of your target spread across the remaining ${daysLeft} days.`}
            </p>
          </>
        ) : (
          <p className="faint">
            Set a monthly target in Settings and this card will show what each day allows.
          </p>
        )}
      </section>
    );
  }

  return null;
}

function CorrectBalanceDialog({
  balanceCents,
  onClose,
  onSubmit,
}: {
  balanceCents: number;
  onClose: () => void;
  onSubmit: (actualCents: number) => Promise<void>;
}) {
  const store = useStoreState();
  const { locale } = store.settings;
  const [text, setText] = useState<string>(centsToDecimalString(balanceCents));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const cents = parseDecimalToCents(text);
    if (cents === null) {
      setError("Enter the balance as it reads in your bank, such as 1234,56.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(cents);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Correct the balance" onClose={onClose}>
      <p className="faint">
        The app has no bank connection. Type what your account actually says and the difference is
        recorded as an adjustment, so the line matches reality without changing any past entry.
      </p>
      {error ? <p className="notice notice--error">{error}</p> : null}
      <div className="field">
        <label className="label" htmlFor="correct-balance">
          Actual balance in EUR
        </label>
        <input
          id="correct-balance"
          className="input num"
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <p className="faint num">Ledger says {formatCents(balanceCents, locale)}.</p>
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
