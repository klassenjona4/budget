import type { Route } from "../router.ts";

type TabBarProps = {
  route: Route;
  onNavigate: (route: Route) => void;
};

/** Only four tabs. The other routes are reached from inside these. */
const TABS: { route: Route; label: string; owns: Route[] }[] = [
  { route: "home", label: "Home", owns: ["home", "transactions"] },
  { route: "add", label: "Add", owns: ["add"] },
  { route: "review", label: "Review", owns: ["review"] },
  { route: "settings", label: "Settings", owns: ["settings", "categories", "recurring"] },
];

export function TabBar({ route, onNavigate }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          aria-current={tab.owns.includes(route) ? "page" : undefined}
          onClick={() => onNavigate(tab.route)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
