import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { StoreProvider } from "./state/store.tsx";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("The root element is missing.");

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
