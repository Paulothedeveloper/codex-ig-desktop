import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

type Hit = { title: string; link: string; snippet: string; source: string; date: string; image: string };
type Scope = "all" | "instagram" | "news";

async function saveBytes(bytes: Uint8Array, name: string) {
  const path = await save({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return;
  await invoke("write_bytes", { path, bytes: Array.from(bytes) });
}

export default function Busca() {
  const { t, nf } = useI18n();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const key = () => localStorage.getItem("codexig_serper") || "";

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setErr("");
    try {
      const query = scope === "instagram" ? `site:instagram.com ${q}` : q;
      const endpoint = scope === "news" ? "news" : "search";
      // passa a chave do Config (pode estar vazia — o Rust cai no arquivo local do Paulo)
      const r = await invoke<Hit[]>("web_search", { query, key: key().trim(), endpoint, num: 20 });
      setHits(r);
    } catch (e) {
      setErr(String(e));
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!hits?.length) return;
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const rows = ["titulo,link,fonte,data,trecho"];
    hits.forEach((h) => rows.push([h.title, h.link, h.source, h.date, h.snippet].map(esc).join(",")));
    saveBytes(new TextEncoder().encode("﻿" + rows.join("\r\n")), `codexig-busca-${q.slice(0, 20)}.csv`);
  }
  function copyList() {
    if (!hits?.length) return;
    navigator.clipboard.writeText(hits.map((h) => `${h.title}\n${h.link}`).join("\n\n"));
  }

  const ScopeBtn = ({ s, label }: { s: Scope; label: string }) => (
    <button
      onClick={() => setScope(s)}
      className={"rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition " + (scope === s ? "bg-[var(--color-teal)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)] hover:text-[var(--color-paper)]")}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <p className="mb-3 text-[13px] text-[var(--color-slate)] leading-snug">{t("busca.intro")}</p>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder={t("busca.ph")}
            className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-4 py-2.5 text-[14px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]"
          />
          <button onClick={run} disabled={loading} className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">
            {loading ? t("busca.searching") : t("busca.search")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("busca.scope")}:</span>
          <ScopeBtn s="all" label={t("busca.all")} />
          <ScopeBtn s="instagram" label="Instagram" />
          <ScopeBtn s="news" label={t("busca.news")} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-slate)]">{t("busca.tips")}</p>
      </div>

      {err && (
        <div className="rounded-xl border border-[#43221d] bg-[#1a0e0c] px-4 py-3 text-[13px] text-[var(--color-coral2)]">{err}</div>
      )}

      {loading && (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-20" />)}</div>
      )}

      {!loading && hits && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-slate)]">{t("busca.found", { n: nf(hits.length) })}</span>
            {hits.length > 0 && (
              <div className="flex gap-2">
                <button onClick={copyList} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.copy")}</button>
                <button onClick={exportCsv} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.exportCsv")}</button>
              </div>
            )}
          </div>
          {hits.length === 0 ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[#090d15] p-6 text-center text-[13px] text-[var(--color-slate)]">{t("busca.empty")}</div>
          ) : (
            <div className="stagger space-y-2">
              {hits.map((h, i) => (
                <a
                  key={h.link + i}
                  href={h.link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 transition hover:border-[var(--color-steel)] hover:-translate-y-0.5"
                >
                  {h.image ? <img src={h.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : null}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-[var(--color-teal2)]">{h.title || h.link}</div>
                    <div className="truncate text-[11.5px] text-[var(--color-slate)]">{h.source}{h.date ? ` · ${h.date}` : ""}</div>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-ink)]">{h.snippet}</p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
