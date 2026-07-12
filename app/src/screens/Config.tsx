import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n, LANGS, type Lang } from "../i18n";
import { useConfirm } from "../Confirm";

const WL_KEY = "codexig_whitelist";

export default function Config() {
  const { t, lang, setLang } = useI18n();
  const confirm = useConfirm();
  const [uid, setUid] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wl, setWl] = useState<string[]>(JSON.parse(localStorage.getItem(WL_KEY) || "[]"));

  async function check() {
    setChecking(true);
    try { setUid(await invoke<string>("ig_session_ok")); } catch { setUid(null); } finally { setChecking(false); }
  }
  useEffect(() => { check(); }, []);

  async function clearWl() {
    if (!(await confirm({ body: t("config.clearWlConfirm"), danger: true }))) return;
    localStorage.setItem(WL_KEY, "[]"); setWl([]);
  }
  function exportWl() {
    const csv = "pk\n" + wl.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "codexig-whitelist.csv"; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">{t("config.igAccount")}</div>
        {checking && <div className="text-[13px] text-[var(--color-slate)]">{t("config.checking")}</div>}
        {!checking && uid && <div className="text-[14px]">{t("config.connected", { uid })} <span className="text-[var(--color-slate)] text-[12px]">{t("config.sessionNote")}</span></div>}
        {!checking && !uid && (
          <div className="text-[13px] text-[var(--color-slate)]">
            {t("config.noSession", { win: t("win.name") })}{" "}
            <button onClick={check} className="text-[var(--color-teal)] font-bold underline">{t("config.recheck")}</button>.
          </div>
        )}
        <div className="mt-3 flex gap-3">
          <button onClick={() => invoke("focus_ig")} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-paper)]">{t("config.openIg")}</button>
          {uid && <button onClick={check} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-slate)]">{t("config.recheckSession")}</button>}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">{t("config.language")}</div>
        <div className="flex flex-wrap gap-2">
          {LANGS.map((l) => {
            const on = l.code === lang;
            return (
              <button
                key={l.code}
                onClick={() => setLang(l.code as Lang)}
                aria-pressed={on}
                className={
                  "rounded-xl px-4 py-2 text-[13px] font-bold border transition " +
                  (on
                    ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent"
                    : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)] hover:text-[var(--color-paper)]")
                }
              >
                {l.native}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">{t("config.whitelist")}</div>
        <div className="text-[14px] text-[var(--color-teal2)] font-bold">{t("config.protectedCount", { n: wl.length })}</div>
        <div className="mt-3 flex gap-3">
          <button onClick={exportWl} disabled={!wl.length} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-paper)] disabled:opacity-40">{t("config.exportCsv")}</button>
          <button onClick={clearWl} disabled={!wl.length} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[#43221d] text-[var(--color-coral2)] disabled:opacity-40">{t("config.clearWl")}</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 text-[13px] text-[var(--color-slate)] leading-relaxed">
        <div className="text-[11px] uppercase tracking-widest mb-2">{t("config.privacy")}</div>
        {t("config.privacyBody")}
      </div>
    </div>
  );
}
