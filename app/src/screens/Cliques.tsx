import { useState } from "react";
import { Ic } from "../icons";
import { useI18n } from "../i18n";

const CFG = "codexig_tracker";
type Cfg = { base: string; rk: string; wk: string };
const loadCfg = (): Cfg => JSON.parse(localStorage.getItem(CFG) || '{"base":"","rk":"","wk":""}');

type Link = { slug: string; clicks: number; url?: string };

export default function Cliques() {
  const { t, nf } = useI18n();
  const [cfg, setCfg] = useState<Cfg>(loadCfg());
  const [editing, setEditing] = useState(!loadCfg().base);
  const [dest, setDest] = useState("");
  const [slug, setSlug] = useState("");
  const [out, setOut] = useState("");
  const [msg, setMsg] = useState("");
  const [links, setLinks] = useState<Link[] | null>(null);

  function saveCfg() {
    const c: Cfg = {
      base: (document.getElementById("cf-base") as HTMLInputElement).value.trim().replace(/\/$/, ""),
      rk: (document.getElementById("cf-rk") as HTMLInputElement).value.trim(),
      wk: (document.getElementById("cf-wk") as HTMLInputElement).value.trim(),
    };
    if (!/^https?:\/\//.test(c.base)) { setMsg(t("clicks.pasteWorker")); return; }
    localStorage.setItem(CFG, JSON.stringify(c));
    setCfg(c); setEditing(false); setMsg("");
    stats(c);
  }

  async function create() {
    setOut(""); setMsg("");
    if (!/^https?:\/\//.test(dest) || !/^[a-z0-9-]{1,40}$/.test(slug)) { setMsg(t("clicks.badSlug")); return; }
    try {
      const r = await fetch(cfg.base + "/api/link", {
        method: "POST",
        headers: { "content-type": "application/json", "x-write-key": cfg.wk },
        body: JSON.stringify({ slug, url: dest }),
      });
      const j = await r.json();
      if (!r.ok || !j.short) throw new Error(j.error || "HTTP " + r.status);
      setOut(j.short);
      stats(cfg);
    } catch (e) { setMsg(t("clicks.createFailed", { e: String(e) })); }
  }

  async function stats(c: Cfg = cfg) {
    setMsg("");
    try {
      const r = await fetch(c.base + "/api/stats?k=" + encodeURIComponent(c.rk));
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      setLinks(j.links || []);
    } catch (e) { setMsg(t("clicks.statsFailed", { e: String(e) })); }
  }

  const max = links && links.length ? Math.max(...links.map((l) => l.clicks), 1) : 1;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-[13px] text-[var(--color-slate)]">{t("clicks.intro")}</p>

      {(editing || !cfg.base) && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("clicks.connect")}</div>
          <input id="cf-base" aria-label={t("clicks.workerAria")} defaultValue={cfg.base} placeholder="https://SEU-WORKER.workers.dev" className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
          <div className="grid grid-cols-2 gap-3">
            <input id="cf-rk" aria-label={t("clicks.readAria")} defaultValue={cfg.rk} placeholder="READ_KEY" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
            <input id="cf-wk" aria-label={t("clicks.writeAria")} defaultValue={cfg.wk} placeholder="WRITE_KEY" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
          </div>
          <button onClick={saveCfg} className="rounded-xl px-4 py-2 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110">{t("clicks.connectBtn")}</button>
        </div>
      )}

      {cfg.base && !editing && (
        <>
          <div className="text-[12px] text-[var(--color-slate)] flex items-center gap-2">
            <span>{t("clicks.tracker")} <b className="text-[var(--color-paper)]">{cfg.base.replace(/^https?:\/\//, "")}</b></span>
            <button onClick={() => setEditing(true)} className="text-[var(--color-teal)] underline">{t("clicks.edit")}</button>
          </div>

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("clicks.createTitle")}</div>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <input value={dest} aria-label={t("clicks.destAria")} onChange={(e) => setDest(e.target.value)} placeholder="https://paulocodex.com" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
              <input value={slug} aria-label={t("clicks.slugAria")} onChange={(e) => setSlug(e.target.value)} placeholder="bio" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
            </div>
            <button onClick={create} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110"><Ic n="link" s={16} />{t("clicks.createBtn")}</button>
            {out && (
              <div>
                <div className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 font-mono text-[12px] text-[var(--color-teal2)] break-all">{out}</div>
                <button onClick={() => navigator.clipboard.writeText(out).then(() => setMsg(t("clicks.copied")))} className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--color-teal)] font-bold"><Ic n="copy" s={15} />{t("clicks.copyBio")}</button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("clicks.perLink")}</div>
              <button onClick={() => stats()} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-teal)] font-bold"><Ic n="report" s={15} />{t("clicks.view")}</button>
            </div>
            {links === null && <div className="text-[13px] text-[var(--color-slate)]">{t("clicks.clickView")}</div>}
            {links && links.length === 0 && <div className="text-[13px] text-[var(--color-slate)]">{t("clicks.noLinks")}</div>}
            {links && links.map((l) => (
              <div key={l.slug} className="mb-3">
                <div className="flex justify-between text-[13px]"><b>/l/{l.slug}</b><span className="text-[var(--color-teal)] font-bold">{nf(l.clicks)}</span></div>
                <div className="h-2 rounded bg-[#0a0f18] mt-1 overflow-hidden"><div style={{ width: (l.clicks / max) * 100 + "%" }} className="h-full bg-[linear-gradient(90deg,#00e5c9,#7ef7e6)]" /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {msg && <div className="text-[13px] text-[var(--color-coral2)]">{msg}</div>}
    </div>
  );
}
