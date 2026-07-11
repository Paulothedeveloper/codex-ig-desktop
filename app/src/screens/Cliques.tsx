import { useState } from "react";
import { Ic } from "../icons";

const nf = new Intl.NumberFormat("pt-BR");
const CFG = "codexig_tracker";
type Cfg = { base: string; rk: string; wk: string };
const loadCfg = (): Cfg => JSON.parse(localStorage.getItem(CFG) || '{"base":"","rk":"","wk":""}');

type Link = { slug: string; clicks: number; url?: string };

export default function Cliques() {
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
    if (!/^https?:\/\//.test(c.base)) { setMsg("Cole a URL do worker (https://…)."); return; }
    localStorage.setItem(CFG, JSON.stringify(c));
    setCfg(c); setEditing(false); setMsg("");
    stats(c);
  }

  async function create() {
    setOut(""); setMsg("");
    if (!/^https?:\/\//.test(dest) || !/^[a-z0-9-]{1,40}$/.test(slug)) { setMsg("Destino https:// e slug (letras/números/hífen)."); return; }
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
    } catch (e) { setMsg("Falhou: " + String(e) + " (confira a chave de escrita)."); }
  }

  async function stats(c: Cfg = cfg) {
    setMsg("");
    try {
      const r = await fetch(c.base + "/api/stats?k=" + encodeURIComponent(c.rk));
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      setLinks(j.links || []);
    } catch (e) { setMsg("Falhou ao ler cliques: " + String(e)); }
  }

  const max = links && links.length ? Math.max(...links.map((l) => l.clicks), 1) : 1;

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-[13px] text-[var(--color-slate)]">
        O tracker roda no <b className="text-[var(--color-paper)]">teu worker</b> (Cloudflare). O Instagram não deixa contar clique no link da bio — isto conta no servidor, sem PII. Aqui é nativo, fala direto (sem trava de CSP).
      </p>

      {(editing || !cfg.base) && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">Conectar o tracker</div>
          <input id="cf-base" aria-label="URL do worker" defaultValue={cfg.base} placeholder="https://codex-ig-tracker.SEU.workers.dev" className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
          <div className="grid grid-cols-2 gap-3">
            <input id="cf-rk" aria-label="Chave de leitura" defaultValue={cfg.rk} placeholder="READ_KEY" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
            <input id="cf-wk" aria-label="Chave de escrita" defaultValue={cfg.wk} placeholder="WRITE_KEY" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
          </div>
          <button onClick={saveCfg} className="rounded-xl px-4 py-2 font-extrabold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110">Conectar</button>
        </div>
      )}

      {cfg.base && !editing && (
        <>
          <div className="text-[12px] text-[var(--color-slate)] flex items-center gap-2">
            <span>Tracker: <b className="text-[var(--color-paper)]">{cfg.base.replace(/^https?:\/\//, "")}</b></span>
            <button onClick={() => setEditing(true)} className="text-[var(--color-teal)] underline">editar</button>
          </div>

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">Criar link rastreado</div>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <input value={dest} aria-label="Destino do link" onChange={(e) => setDest(e.target.value)} placeholder="https://paulocodex.com" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
              <input value={slug} aria-label="Slug do link" onChange={(e) => setSlug(e.target.value)} placeholder="bio" className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
            </div>
            <button onClick={create} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-extrabold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110"><Ic n="link" s={16} />Criar link</button>
            {out && (
              <div>
                <div className="bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 font-mono text-[12px] text-[var(--color-teal2)] break-all">{out}</div>
                <button onClick={() => navigator.clipboard.writeText(out).then(() => setMsg("Copiado."))} className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--color-teal)] font-bold"><Ic n="copy" s={15} />Copiar (use na bio)</button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">Cliques por link</div>
              <button onClick={() => stats()} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-teal)] font-bold"><Ic n="report" s={15} />Ver cliques</button>
            </div>
            {links === null && <div className="text-[13px] text-[var(--color-slate)]">Clique em "Ver cliques".</div>}
            {links && links.length === 0 && <div className="text-[13px] text-[var(--color-slate)]">Nenhum link ainda. Crie um acima.</div>}
            {links && links.map((l) => (
              <div key={l.slug} className="mb-3">
                <div className="flex justify-between text-[13px]"><b>/l/{l.slug}</b><span className="text-[var(--color-teal)] font-extrabold">{nf.format(l.clicks)}</span></div>
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
