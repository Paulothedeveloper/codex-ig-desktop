import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { Select } from "../Select";

type Hit = { title: string; link: string; snippet: string; source: string; date: string; image: string };
type Ranked = Hit & { likes: number; comments: number };
type Scope = "all" | "instagram" | "news";
type Period = "" | "d" | "w" | "m" | "y";
type Sort = "rel" | "recent" | "old" | "likes" | "comments";

// tira curtidas/comentários do trecho (ex "702 likes, 91 comments" · "1.2K likes") pra ordenar
function parseCount(snippet: string, kind: "likes" | "comments"): number {
  const re = kind === "likes"
    ? /([\d.,]+)\s*(k|m|mil)?\s*(?:likes|curtidas)/i
    : /([\d.,]+)\s*(k|m|mil)?\s*(?:comments|coment)/i;
  const m = snippet.match(re);
  if (!m) return 0;
  const suf = (m[2] || "").toLowerCase();
  let n = suf
    ? parseFloat(m[1].replace(",", ".")) * (suf === "m" ? 1e6 : 1e3)
    : parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Math.round(n) || 0;
}

async function saveBytes(bytes: Uint8Array, name: string) {
  const path = await save({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return;
  await invoke("write_bytes", { path, bytes: Array.from(bytes) });
}

export default function Busca() {
  const { t, nf } = useI18n();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [period, setPeriod] = useState<Period>("");
  const [sort, setSort] = useState<Sort>("rel");
  const [hits, setHits] = useState<Ranked[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const key = () => localStorage.getItem("codexig_serper") || "";

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setErr("");
    try {
      // Serper grátis NÃO deixa usar `site:` → pro Instagram busca "termo instagram" e filtra o domínio no Rust.
      const query = scope === "instagram" ? `${q} instagram` : q;
      const endpoint = scope === "news" ? "news" : "search";
      const site = scope === "instagram" ? "instagram.com" : undefined;
      // tbs do Google: período (qdr) + ordenar por data (sbd:1)
      const tbsParts: string[] = [];
      if (period) tbsParts.push(`qdr:${period}`);
      if (sort === "recent") tbsParts.push("sbd:1");
      const tbs = tbsParts.join(",");
      // passa a chave do Config (pode estar vazia — o Rust cai no arquivo local do Paulo)
      const r = await invoke<Hit[]>("web_search", { query, key: key().trim(), endpoint, num: 30, site, tbs });
      // extrai curtidas/comentários do trecho + ordena client-side (o que o Google não ordena)
      const ranked: Ranked[] = r.map((h) => ({ ...h, likes: parseCount(h.snippet, "likes"), comments: parseCount(h.snippet, "comments") }));
      if (sort === "likes") ranked.sort((a, b) => b.likes - a.likes);
      else if (sort === "comments") ranked.sort((a, b) => b.comments - a.comments);
      else if (sort === "old") ranked.reverse();
      setHits(ranked);
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
    const safe = q.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 24) || "busca";
    saveBytes(new TextEncoder().encode("﻿" + rows.join("\r\n")), `codexig-busca-${safe}.csv`);
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
        <div className="mt-3 flex flex-wrap gap-4">
          <div className="min-w-[150px]">
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("busca.period")}</span>
            <Select
              ariaLabel={t("busca.period")}
              value={period}
              onChange={(v) => setPeriod(v as Period)}
              options={[
                { value: "", label: t("busca.pAny") },
                { value: "d", label: t("busca.p24h") },
                { value: "w", label: t("busca.p7d") },
                { value: "m", label: t("busca.pMonth") },
                { value: "y", label: t("busca.pYear") },
              ]}
            />
          </div>
          <div className="min-w-[170px]">
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("busca.sort")}</span>
            <Select
              ariaLabel={t("busca.sort")}
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={[
                { value: "rel", label: t("busca.sRel") },
                { value: "recent", label: t("busca.sRecent") },
                { value: "old", label: t("busca.sOld") },
                { value: "likes", label: t("busca.sLikes") },
                { value: "comments", label: t("busca.sComments") },
              ]}
            />
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-[var(--color-slate)]">{t("busca.tips")} · {t("busca.sortNote")}</p>
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
                    <div className="flex flex-wrap items-center gap-x-2 truncate text-[11.5px] text-[var(--color-slate)]">
                      <span>{h.source}{h.date ? ` · ${h.date}` : ""}</span>
                      {h.likes > 0 ? <span className="text-[var(--color-teal2)]">{nf(h.likes)} {t("busca.likes")}</span> : null}
                      {h.comments > 0 ? <span className="text-[var(--color-teal2)]">{nf(h.comments)} {t("busca.comments")}</span> : null}
                    </div>
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
