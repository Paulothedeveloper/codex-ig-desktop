import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n, LANGS, type Lang } from "../i18n";
import { useConfirm } from "../Confirm";
import { privacyOn, setPrivacy } from "../privacy";
import Help from "../Help";
import { checkForUpdate, UPDATE_EVENT, COACH_EVENT } from "../updater";

const WL_KEY = "codexig_whitelist";
const SERPER_KEY = "codexig_serper";
const GROQ_KEY = "codexig_groq";

export default function Config() {
  const { t, lang, setLang } = useI18n();
  const confirm = useConfirm();
  const [uid, setUid] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wl, setWl] = useState<string[]>(JSON.parse(localStorage.getItem(WL_KEY) || "[]"));
  const [blur, setBlur] = useState(privacyOn());
  const [serper, setSerper] = useState(localStorage.getItem(SERPER_KEY) || "");
  const [groq, setGroq] = useState(localStorage.getItem(GROQ_KEY) || "");
  const [ver, setVer] = useState("");
  const [updMsg, setUpdMsg] = useState("");
  const [updChecking, setUpdChecking] = useState(false);
  useEffect(() => { getVersion().then(setVer).catch(() => {}); }, []);

  async function checkUpd() {
    setUpdChecking(true); setUpdMsg("");
    const u = await checkForUpdate();
    setUpdChecking(false);
    if (u) window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: u }));
    else setUpdMsg(t("config.upToDate"));
  }
  function reopenTutorial() {
    localStorage.setItem("codexig_onboarded", "0");
    window.dispatchEvent(new CustomEvent(COACH_EVENT));
  }

  async function check() {
    setChecking(true);
    try { setUid(await invoke<string>("ig_session_ok")); } catch { setUid(null); } finally { setChecking(false); }
  }
  useEffect(() => { check(); }, []);

  async function clearWl() {
    if (!(await confirm({ body: t("config.clearWlConfirm"), danger: true }))) return;
    localStorage.setItem(WL_KEY, "[]"); setWl([]);
  }
  async function exportWl() {
    // Tauri não faz download de browser (a.click = no-op) — diálogo nativo + escrita no Rust.
    const bytes = new TextEncoder().encode("﻿pk\r\n" + wl.join("\r\n"));
    const path = await save({ defaultPath: "codexig-whitelist.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    await invoke("write_bytes", { path, bytes: Array.from(bytes) });
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

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">{t("config.search")}</div>
        <div className="text-[12px] text-[var(--color-slate)] leading-snug mb-2">{t("config.searchHint")}</div>
        <div className="flex gap-2">
          <input
            type="password"
            value={serper}
            onChange={(e) => { setSerper(e.target.value); localStorage.setItem(SERPER_KEY, e.target.value.trim()); }}
            placeholder={t("config.searchPh")}
            className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]"
          />
          <a href="https://serper.dev" target="_blank" rel="noreferrer" className="shrink-0 rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-teal2)]">serper.dev</a>
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-slate)]">{serper ? t("config.searchSet") : t("config.searchUnset")}</div>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={groq}
            onChange={(e) => { setGroq(e.target.value); localStorage.setItem(GROQ_KEY, e.target.value.trim()); }}
            placeholder={t("config.aiPh")}
            className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]"
          />
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="shrink-0 rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-teal2)]">groq</a>
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-slate)]">{t("config.aiHint")}</div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">{t("config.privacy")}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-[var(--color-paper)]">{t("config.privacyBlur")}</div>
            <div className="mt-1 text-[12px] text-[var(--color-slate)] leading-snug">{t("config.privacyBlurHint")}</div>
          </div>
          <button
            role="switch"
            aria-checked={blur}
            onClick={() => { const v = !blur; setBlur(v); setPrivacy(v); }}
            className={"relative h-7 w-12 shrink-0 rounded-full border transition " + (blur ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)]")}
          >
            <span className={"absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white transition-all " + (blur ? "left-[26px]" : "left-[3px]")} />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 text-[13px] text-[var(--color-slate)] leading-relaxed">
        {t("config.privacyBody")}
      </div>

      {/* Sobre + versão + atualizar + tutorial */}
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-3 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("config.about")} <Help label={t("config.about")} text={t("help.about")} /></div>
        <div className="flex items-center gap-2 text-[14px]">
          <span className="font-bold text-[var(--color-paper)]">Codex IG</span>
          {ver && <span className="rounded-md border border-[var(--color-steel)] px-2 py-0.5 text-[12px] tabular-nums text-[var(--color-teal2)]">v{ver}</span>}
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--color-slate)] leading-relaxed">
          {t("config.aboutBy")}{" "}
          <a href="https://paulocodex.com" target="_blank" rel="noreferrer" className="font-semibold text-[var(--color-teal2)] hover:underline">paulocodex.com</a>
          {" · "}
          <a href="mailto:contato@paulocodex.com" className="text-[var(--color-teal2)] hover:underline">contato@paulocodex.com</a>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={checkUpd} disabled={updChecking} className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2 text-[13px] font-bold text-[#04120f] hover:brightness-110 disabled:opacity-50">{updChecking ? t("config.checkingUpd") : t("config.checkUpd")}</button>
          <button onClick={reopenTutorial} className="rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2 text-[13px] font-bold text-[var(--color-paper)]">{t("config.reopenTutorial")}</button>
        </div>
        {updMsg && <div className="mt-2 text-[12px] text-[var(--color-teal2)]">{updMsg}</div>}
      </div>
    </div>
  );
}
