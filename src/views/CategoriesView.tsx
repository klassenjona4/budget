import { useMemo, useState } from "react";
import { Dialog } from "../components/Dialog.tsx";
import { centsToDecimalString, formatCentsAbs, parseDecimalToCents } from "../lib/money.ts";
import { useActions, useStoreState } from "../state/store.tsx";
import { PALETTE, type Category, type CategoryKind } from "../lib/types.ts";

export function CategoriesView() {
  const store = useStoreState();
  const actions = useActions();
  const { locale } = store.settings;
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);

  const active = useMemo(
    () => store.categories.filter((category) => !category.archived),
    [store.categories],
  );
  const archived = useMemo(
    () => store.categories.filter((category) => category.archived),
    [store.categories],
  );

  async function move(category: Category, delta: number) {
    const ids = active.map((row) => row.id);
    const index = ids.indexOf(category.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const reordered = [...ids];
    const [moved] = reordered.splice(index, 1);
    if (moved) reordered.splice(target, 0, moved);
    await actions.reorderCategories([...reordered, ...archived.map((row) => row.id)]);
  }

  return (
    <main className="screen">
      <div className="stack">
        <div className="row-between">
          <h1 className="title">Categories</h1>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            Add
          </button>
        </div>

        <ul className="list">
          {active.map((category, index) => (
            <li key={category.id}>
              <div className="list-item">
                <div className="row-between">
                  <span className="with-swatch">
                    <span className="swatch" style={{ background: category.colour }} aria-hidden="true" />
                    <span>{category.name}</span>
                  </span>
                  <span className="num">{formatCentsAbs(category.monthlyPlanCents, locale)}</span>
                </div>
                <div className="row-between spaced">
                  <span className="faint">{category.kind === "fixed" ? "Fixed" : "Variable"}</span>
                  <span className="button-group">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move ${category.name} up`}
                      disabled={index === 0}
                      onClick={() => void move(category, -1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Move ${category.name} down`}
                      disabled={index === active.length - 1}
                      onClick={() => void move(category, 1)}
                    >
                      Down
                    </button>
                    <button type="button" className="btn" onClick={() => setEditing(category)}>
                      Edit
                    </button>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {archived.length > 0 ? (
          <section className="stack stack--tight">
            <h2 className="label">Archived</h2>
            <p className="faint">
              Archived categories keep their transactions but do not appear when adding.
            </p>
            <ul className="list">
              {archived.map((category) => (
                <li key={category.id}>
                  <div className="list-item">
                    <div className="row-between">
                      <span>{category.name}</span>
                      <button type="button" className="btn" onClick={() => setEditing(category)}>
                        Edit
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {editing ? <CategoryDialog category={editing} onClose={() => setEditing(null)} /> : null}
      {adding ? <CategoryDialog category={null} onClose={() => setAdding(false)} /> : null}
    </main>
  );
}

function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const actions = useActions();
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "variable");
  const [plan, setPlan] = useState<string>(centsToDecimalString(category?.monthlyPlanCents ?? 0));
  const [colour, setColour] = useState(category?.colour ?? PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Enter a name.");
      return;
    }
    const cents = parseDecimalToCents(plan);
    if (cents === null || cents < 0) {
      setError("Enter a monthly plan such as 250,00.");
      return;
    }
    setBusy(true);
    try {
      if (category) {
        await actions.updateCategory({
          ...category,
          name: trimmed,
          kind,
          monthlyPlanCents: cents,
          colour,
        });
      } else {
        await actions.addCategory({ name: trimmed, kind, monthlyPlanCents: cents, colour });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived() {
    if (!category) return;
    setBusy(true);
    try {
      await actions.updateCategory({ ...category, archived: !category.archived });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={category ? "Edit category" : "New category"} onClose={onClose}>
      {error ? <p className="notice notice--error">{error}</p> : null}

      <div className="field">
        <label className="label" htmlFor="category-name">
          Name
        </label>
        <input
          id="category-name"
          className="input"
          type="text"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="category-plan">
          Monthly plan in EUR
        </label>
        <input
          id="category-plan"
          className="input num"
          type="text"
          inputMode="decimal"
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">Kind</span>
        <div className="segmented" role="group" aria-label="Kind">
          <button type="button" aria-pressed={kind === "fixed"} onClick={() => setKind("fixed")}>
            Fixed
          </button>
          <button
            type="button"
            aria-pressed={kind === "variable"}
            onClick={() => setKind("variable")}
          >
            Variable
          </button>
        </div>
      </div>

      <div className="field">
        <span className="label">Colour</span>
        <div className="chip-grid">
          {PALETTE.map((value) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={colour === value}
              aria-label={`Colour ${value}`}
              onClick={() => setColour(value)}
            >
              <span className="swatch" style={{ background: value }} aria-hidden="true" />
              <span className="num">{value}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy}>
          Save
        </button>
      </div>

      {category ? (
        <button
          type="button"
          className="btn btn--block"
          onClick={() => void toggleArchived()}
          disabled={busy}
        >
          {category.archived ? "Restore from archive" : "Archive category"}
        </button>
      ) : null}
    </Dialog>
  );
}
