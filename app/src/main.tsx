import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Space Grotesk self-hosted (woff2) — regra do Manual, nada de <link> do Google
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
