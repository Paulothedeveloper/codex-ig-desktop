import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ConfirmProvider } from "./Confirm";
import { initPrivacy } from "./privacy";
// Space Grotesk self-hosted (woff2) — regra do Manual, nada de <link> do Google
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";

initPrivacy(); // aplica o borrar-@ salvo antes de renderizar

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </I18nProvider>
  </React.StrictMode>,
);
