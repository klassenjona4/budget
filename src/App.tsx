import { useEffect, useState } from "react";
import { TabBar } from "./components/TabBar.tsx";
import { useRoute } from "./router.ts";
import { useStoreState } from "./state/store.tsx";
import { AddTransactionView } from "./views/AddTransactionView.tsx";
import { CategoriesView } from "./views/CategoriesView.tsx";
import { HomeView } from "./views/HomeView.tsx";
import { LockView } from "./views/LockView.tsx";
import { RecurringView } from "./views/RecurringView.tsx";
import { ReviewView } from "./views/ReviewView.tsx";
import { SetupWizard } from "./views/SetupWizard.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { TransactionsView } from "./views/TransactionsView.tsx";

export function App() {
  const store = useStoreState();
  const [route, navigate] = useRoute();
  const [wizardOpen, setWizardOpen] = useState(false);

  // The wizard stays mounted after the vault is created so that the optional
  // biometric step can finish before the main screens appear.
  useEffect(() => {
    if (store.status === "setup") setWizardOpen(true);
  }, [store.status]);

  if (store.status === "loading") {
    return (
      <div className="app">
        <main className="screen screen--plain">
          <div className="centre">
            <p className="muted text-centre">Opening the vault.</p>
          </div>
        </main>
      </div>
    );
  }

  if (wizardOpen) {
    return (
      <div className="app">
        <SetupWizard
          onDone={() => {
            setWizardOpen(false);
            navigate("home");
          }}
        />
      </div>
    );
  }

  if (store.status !== "unlocked") {
    return (
      <div className="app">
        <LockView />
      </div>
    );
  }

  return (
    <div className="app">
      {route === "home" ? <HomeView onNavigate={navigate} /> : null}
      {route === "add" ? <AddTransactionView onNavigate={navigate} /> : null}
      {route === "review" ? <ReviewView /> : null}
      {route === "settings" ? <SettingsView onNavigate={navigate} /> : null}
      {route === "transactions" ? <TransactionsView onNavigate={navigate} /> : null}
      {route === "categories" ? <CategoriesView onNavigate={navigate} /> : null}
      {route === "recurring" ? <RecurringView onNavigate={navigate} /> : null}
      <TabBar route={route} onNavigate={navigate} />
    </div>
  );
}
