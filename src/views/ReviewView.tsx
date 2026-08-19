import { useMemo, useState } from "react";
import { DayBars } from "../components/DayBars.tsx";
import { DonutChart } from "../components/DonutChart.tsx";
import { sharePercent, summariseMonth, topSlices } from "../lib/insights.ts";
import { formatCentsAbs, formatCentsSigned } from "../lib/money.ts";
import {
  currentPeriod,
  formatMonthLabel,
  formatPeriodRange,
  formatShortDate,
  shiftPeriod,
} from "../lib/period.ts";
import { useStoreState } from "../state/store.tsx";

const TOP_SLICES = 6;

export function ReviewView() {
  const store = useStoreState();
  const { locale, monthStartDay } = store.settings;
  const [offset, setOffset] = useState(0);

  const period = useMemo(() => {
    const base = currentPeriod(monthStartDay);
    return offset === 0 ? base : shiftPeriod(base, offset);
  }, [monthStartDay, offset]);

  const insight = useMemo(
    () => summariseMonth(store.categories, store.transactions, period, store.settings),
    [period, store.categories, store.settings, store.transactions],
  );

  const previous = useMemo(
    () =>
      summariseMonth(
        store.categories,
        store.transactions,
        shiftPeriod(period, -1),
        store.settings,
      ),
    [period, store.categories, store.settings, store.transactions],
  );

  const slices = useMemo(() => topSlices(insight.byCategory, TOP_SLICES), [insight.byCategory]);
  const delta = insight.spentCents - previous.spentCents;
  const peak = insight.byCategory[0]?.amountCents ?? 0;

  return (
    <main className="screen">
      <div className="stack">
        <div className="row-between">
          <button
            type="button"
            className="btn"
            aria-label="Previous month"
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
            aria-label="Next month"
            disabled={offset >= 0}
            onClick={() => setOffset(offset + 1)}
          >
            Next
          </button>
        </div>

        <section className="card">
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
        </section>

        <section className="card stack stack--tight">
          <h2 className="label">Where it went</h2>
          {insight.spentCents > 0 ? (
            <>
              <div className="donut-row">
                <DonutChart slices={slices} totalCents={insight.spentCents} locale={locale} />
                <ul className="legend">
                  {slices.map((slice) => (
                    <li key={slice.categoryId}>
                      <span className="with-swatch">
                        <span
                          className="swatch"
                          style={{ background: slice.colour }}
                          aria-hidden="true"
                        />
                        <span>{slice.name}</span>
                      </span>
                      <span className="num faint">{sharePercent(slice.sharePerMille)} percent</span>
                    </li>
                  ))}
                </ul>
              </div>

              <ul className="list">
                {insight.byCategory.map((slice) => (
                  <li key={slice.categoryId} className="bar-row">
                    <div className="row-between">
                      <span>{slice.name}</span>
                      <span className="num">{formatCentsAbs(slice.amountCents, locale)}</span>
                    </div>
                    <div className="progress">
                      <span
                        style={{
                          width: `${peak > 0 ? Math.round((slice.amountCents * 100) / peak) : 0}%`,
                          background: slice.colour,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No spending recorded in this period.</p>
          )}
        </section>

        <section className="card stack stack--tight">
          <h2 className="label">Day by day</h2>
          <DayBars days={insight.daily} locale={locale} />
          {insight.busiestDay ? (
            <p className="faint num">
              Heaviest day {formatShortDate(insight.busiestDay.date, locale)} with{" "}
              {formatCentsAbs(insight.busiestDay.spentCents, locale)}
            </p>
          ) : null}
        </section>

        <section className="card stack stack--tight">
          <h2 className="label">Against last month</h2>
          <p className={delta > 0 ? "subtitle num negative" : "subtitle num positive"}>
            {delta === 0 ? "The same" : `${formatCentsSigned(delta, locale)}`}
          </p>
          <p className="faint num">
            Last period {formatCentsAbs(previous.spentCents, locale)} across{" "}
            {previous.transactionCount} entries. This period {insight.transactionCount} entries.
          </p>
          {insight.targetCents > 0 ? (
            <p className="faint num">
              Target {formatCentsAbs(insight.targetCents, locale)}, at this rate the period ends at{" "}
              {formatCentsAbs(insight.projectedCents, locale)}.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
