import { useEffect, useState } from "react";
import "./index.css";
import Relatorio from "./screens/Relatorio";
import Instagram from "./screens/Instagram";
import Posts from "./screens/Posts";
import Saved from "./screens/Saved";
import Busca from "./screens/Busca";
import Cliques from "./screens/Cliques";
import Config from "./screens/Config";
import { Logo } from "./Logo";
import { useI18n } from "./i18n";
import LanguageGate from "./LanguageGate";
import Coach, { isOnboarded } from "./Coach";
import Portal from "./Portal";
import Help from "./Help";
import { checkUpdateOnBoot, runUpdate, UPDATE_EVENT, COACH_EVENT } from "./updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

/* ---- ícones SVG (zero emoji, regra do Manual) ---- */
const ICON: Record<string, string> = {
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  posts:
    '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  saved: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
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

type TabId = "instagram" | "report" | "posts" | "saved" | "busca" | "clicks" | "config";
const TAB_IDS: TabId[] = ["instagram", "report", "posts", "saved", "busca", "clicks", "config"];

export default function App() {
  const { t, needsChoice } = useI18n();
  const [tab, setTab] = useState<TabId>("report");
  const [coach, setCoach] = useState(false);
  const [ver, setVer] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [updBusy, setUpdBusy] = useState(false);

  useEffect(() => { getVersion().then(setVer).catch(() => {}); }, []);
  useEffect(() => {
    const onUpd = (e: Event) => setUpdate((e as CustomEvent).detail as Update);
    const onCoach = () => { setTab("instagram"); setCoach(true); };
    window.addEventListener(UPDATE_EVENT, onUpd);
    window.addEventListener(COACH_EVENT, onCoach);
    return () => { window.removeEventListener(UPDATE_EVENT, onUpd); window.removeEventListener(COACH_EVENT, onCoach); };
  }, []);

  // coachmarks: dispara quando o app aparece (idioma já escolhido) e ainda não foi visto.
  // NÃO dá pra calcular no useState inicial: no 1º render needsChoice=true (gate na tela),
  // e o initializer só roda 1x — ficaria falso pra sempre.
  useEffect(() => {
    if (!needsChoice && !isOnboarded()) setCoach(true);
  }, [needsChoice]);

  // checa update assinado no boot (silencioso se não houver)
  useEffect(() => { if (!needsChoice) checkUpdateOnBoot(); }, [needsChoice]);

  // 1ª abertura: escolher idioma ANTES de tudo (regra do Manual)
  if (needsChoice) return <LanguageGate />;

  const tabs = TAB_IDS.map((id) => ({ id, label: t("nav." + id + ".label"), sub: t("nav." + id + ".sub") }));
  const active = tabs.find((x) => x.id === tab)!;

  return (
    <div className="relative flex h-screen w-screen overflow-hidden text-[var(--color-paper)]">
      <div className="aurora" />

      {/* sidebar */}
      <aside className="relative z-10 flex w-60 flex-col border-r border-[var(--color-line)] bg-[linear-gradient(180deg,#0c111b,#090d14)]">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--color-line)]">
          <Logo s={38} />
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-tight leading-none bg-gradient-to-r from-[#00e5c9] via-[#7ef7e6] to-[#00e5c9] bg-clip-text text-transparent">
              Codex IG
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-slate)]">{t("brand.tagline")}</div>
          </div>
        </div>

        <nav className="flex-1 p-2.5 space-y-1">
          {tabs.map((tb) => {
            const on = tb.id === tab;
            return (
              <button
                id={"nav-" + tb.id}
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={
                  "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition " +
                  (on
                    ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] shadow-[0_8px_20px_-8px_rgba(0,229,201,.6)]"
                    : "text-[var(--color-slate)] hover:text-[var(--color-paper)] hover:bg-white/5")
                }
              >
                <Ic n={tb.id} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold leading-tight">{tb.label}</span>
                  <span className={"block text-[11px] leading-tight " + (on ? "text-[#04120f]/70" : "text-[var(--color-slate)]")}>
                    {tb.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[var(--color-line)] text-[10.5px] text-[var(--color-slate)]">
          <div>{t("shell.footer")}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <a href="https://paulocodex.com" target="_blank" rel="noreferrer" className="font-semibold text-[var(--color-teal2)] hover:underline">Paulocodex</a>
            {ver && <span className="text-[var(--color-slate)]">· v{ver}</span>}
          </div>
        </div>
      </aside>

      {/* main */}
      <main className="relative z-10 flex-1 overflow-auto">
        <header className="sticky top-0 z-10 backdrop-blur-sm bg-[var(--color-void)]/70 border-b border-[var(--color-line)] px-7 py-4">
          <div key={tab} className="enter">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              {active.label}
              <Help label={active.label} text={t("help." + tab)} />
            </h1>
            <p className="text-[13px] text-[var(--color-slate)]">{active.sub}</p>
          </div>
        </header>

        {/* telas ficam MONTADAS (só escondidas) — trocar de aba não desmonta:
            preserva o estado carregado e mantém o loop de unfollow rodando em 2º plano. */}
        <div className="p-7 max-w-4xl">
          <div className={tab === "instagram" ? "screen-in" : "hidden"}><Instagram /></div>
          <div className={tab === "report" ? "screen-in" : "hidden"}><Relatorio /></div>
          <div className={tab === "posts" ? "screen-in" : "hidden"}><Posts /></div>
          <div className={tab === "saved" ? "screen-in" : "hidden"}><Saved /></div>
          <div className={tab === "busca" ? "screen-in" : "hidden"}><Busca /></div>
          <div className={tab === "clicks" ? "screen-in" : "hidden"}><Cliques /></div>
          <div className={tab === "config" ? "screen-in" : "hidden"}><Config /></div>
        </div>
      </main>

      {coach && <Coach onStep={(id) => setTab(id as TabId)} onClose={() => setCoach(false)} />}

      {update && (
        <Portal>
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
            <div className="pop w-full max-w-sm rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
              <div className="text-[15px] font-bold text-[var(--color-teal2)]">{t("update.title")}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-slate)]">{t("update.body", { v: update.version })}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button disabled={updBusy} onClick={() => setUpdate(null)} className="rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2 text-[13px] font-bold text-[var(--color-slate)] disabled:opacity-40">{t("update.later")}</button>
                <button disabled={updBusy} onClick={async () => { setUpdBusy(true); try { await runUpdate(update); } catch (e) { setUpdBusy(false); alert(String(e)); } }} className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2 text-[13px] font-bold text-[#04120f] disabled:opacity-60">{updBusy ? t("update.installing") : t("update.now")}</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
