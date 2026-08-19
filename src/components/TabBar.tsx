import type { Route } from "../router.ts";

type TabBarProps = {
  route: Route;
  onNavigate: (route: Route) => void;
};

const TABS: { route: Route; label: string }[] = [
  { route: "overview", label: "Overview" },
  { route: "add", label: "Add" },
  { route: "transactions", label: "History" },
  { route: "categories", label: "Categories" },
  { route: "settings", label: "Settings" },
];

export function TabBar({ route, onNavigate }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          aria-current={route === tab.route ? "page" : undefined}
          onClick={() => onNavigate(tab.route)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
