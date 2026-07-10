import { useState } from "react";
import "./index.css";
import Relatorio from "./screens/Relatorio";

/* ---- ícones SVG (zero emoji, regra do Manual) ---- */
const ICON: Record<string, string> = {
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  clicks:
    '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  config:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};

function Ic({ n, s = 20 }: { n: string; s?: number }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON[n] || "" }}
    />
  );
}

/* ---- marca orbit ---- */
function Logo({ s = 34 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 1024 1024" style={{ flex: "0 0 auto" }}>
      <defs>
        <linearGradient id="lg-t" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0aa892" />
          <stop offset="1" stopColor="#00e5c9" />
        </linearGradient>
        <radialGradient id="lg-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff4d3d" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff4d3d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="12" y="12" width="1000" height="1000" rx="224" fill="#0d1420" />
      <path d="M 296 726 A 348 306 -12 0 1 694 366" fill="none" stroke="url(#lg-t)" strokeWidth="84" strokeLinecap="round" />
      <circle cx="704" cy="344" r="158" fill="url(#lg-g)" />
      <circle cx="704" cy="344" r="76" fill="#ff4d3d" />
    </svg>
  );
}

type TabId = "instagram" | "report" | "clicks" | "config";
const TABS: { id: TabId; label: string; sub: string }[] = [
  { id: "instagram", label: "Instagram", sub: "sessão + limpeza" },
  { id: "report", label: "Relatório", sub: "crescimento & posts" },
  { id: "clicks", label: "Cliques", sub: "tracker de links" },
  { id: "config", label: "Config", sub: "conta & export" },
];

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
      <div className="text-[var(--color-teal)] text-sm font-bold uppercase tracking-widest">{title}</div>
      <p className="mt-3 text-[var(--color-slate)] text-sm max-w-md mx-auto">{desc}</p>
      <div className="mt-4 inline-block text-[11px] text-[var(--color-slate)] border border-[var(--color-steel)] rounded-full px-3 py-1">
        em construção — Fase 2-5
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("report");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden text-[var(--color-paper)]">
      <div className="aurora" />

      {/* sidebar */}
      <aside className="relative z-10 flex w-60 flex-col border-r border-[var(--color-line)] bg-[linear-gradient(180deg,#0c111b,#090d14)]">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--color-line)]">
          <Logo s={38} />
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-tight leading-none bg-gradient-to-r from-[#00e5c9] via-[#7ef7e6] to-[#00e5c9] bg-clip-text text-transparent">
              Codex IG
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-slate)]">growth suite</div>
          </div>
        </div>

        <nav className="flex-1 p-2.5 space-y-1">
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition " +
                  (on
                    ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] shadow-[0_8px_20px_-8px_rgba(0,229,201,.6)]"
                    : "text-[var(--color-slate)] hover:text-[var(--color-paper)] hover:bg-white/5")
                }
              >
                <Ic n={t.id} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold leading-tight">{t.label}</span>
                  <span className={"block text-[11px] leading-tight " + (on ? "text-[#04120f]/70" : "text-[var(--color-slate)]")}>
                    {t.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 text-[10.5px] text-[var(--color-slate)] border-t border-[var(--color-line)]">
          local · tua sessão · zero servidor
        </div>
      </aside>

      {/* main */}
      <main className="relative z-10 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 backdrop-blur-sm bg-[var(--color-void)]/70 border-b border-[var(--color-line)] px-7 py-4">
          <h1 className="text-xl font-extrabold tracking-tight">{active.label}</h1>
          <p className="text-[13px] text-[var(--color-slate)]">{active.sub}</p>
        </header>

        <div className="p-7 max-w-4xl">
          {tab === "instagram" && (
            <Placeholder title="Instagram" desc="Aqui vai o webview logado do Instagram com o painel injetado: limpar quem não retribui (ritmado, whitelist) e achar alvos." />
          )}
          {tab === "report" && <Relatorio />}
          {tab === "clicks" && (
            <Placeholder title="Cliques" desc="Gerencia o tracker de links da bio (criar link + gráfico de cliques por dia). Fala com o worker direto — sem a trava CSP do Instagram." />
          )}
          {tab === "config" && (
            <Placeholder title="Config" desc="Conta conectada, whitelist protegida e export CSV do relatório e dos cliques." />
          )}
        </div>
      </main>
    </div>
  );
}
