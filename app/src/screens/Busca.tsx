import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { Select } from "../Select";
import { exportDossierPdf } from "../pdf";

type Hit = { title: string; link: string; snippet: string; source: string; date: string; image: string };
type Sent = "pos" | "neg" | "neu";
type Ranked = Hit & { likes: number; comments: number; sent?: Sent };
type Kind = "any" | "search" | "videos" | "images" | "news" | "places";
type Net = "all" | "instagram" | "facebook" | "x" | "youtube" | "tiktok";
type Period = "" | "d" | "w" | "m" | "y";
type Sort = "rel" | "recent" | "old" | "likes" | "comments";

const NET_DOMAINS: Record<Net, string[]> = {
  all: [],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  x: ["x.com", "twitter.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
};
const NET_HINT: Record<Net, string> = { all: "", instagram: "instagram", facebook: "facebook", x: "twitter", youtube: "youtube", tiktok: "tiktok" };

function parseCount(snippet: string, kind: "likes" | "comments"): number {
  const re = kind === "likes"
    ? /([\d.,]+)\s*(k|m|mil)?\s*(?:likes|curtidas)/i
    : /([\d.,]+)\s*(k|m|mil)?\s*(?:comments|coment)/i;
  const m = snippet.match(re);
  if (!m) return 0;
  const suf = (m[2] || "").toLowerCase();
  const n = suf ? parseFloat(m[1].replace(",", ".")) * (suf === "m" ? 1e6 : 1e3) : parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Math.round(n) || 0;
}

async function saveBytes(bytes: Uint8Array, name: string, ext: string, filterName: string) {
  const path = await save({ defaultPath: name, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return;
  await invoke("write_bytes", { path, bytes: Array.from(bytes) });
}

export default function Busca() {
  const { t, nf } = useI18n();
  const serperKey = () => localStorage.getItem("codexig_serper") || "";
  const groqKey = () => localStorage.getItem("codexig_groq") || "";

  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("any");
  const [net, setNet] = useState<Net>("all");
  const [period, setPeriod] = useState<Period>("");
  const [sort, setSort] = useState<Sort>("rel");
  const [exclude, setExclude] = useState("");
  const [onlyEng, setOnlyEng] = useState(false);
  const [sentFilter, setSentFilter] = useState<"all" | "neg" | "pos">("all");

  const [hits, setHits] = useState<Ranked[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [presets, setPresets] = useState<string[]>(JSON.parse(localStorage.getItem("codexig_monitor") || "[]"));
  const [reply, setReply] = useState<{ h: Ranked; text: string } | null>(null);
  const [cmp, setCmp] = useState<{ open: boolean; input: string; busy: string; rows: { term: string; total: number; negPct: number; sample: string }[] | null }>({ open: false, input: "", busy: "", rows: null });

  function applyClient(list: Ranked[]): Ranked[] {
    let r = [...list];
    if (net !== "all") r = r.filter((h) => NET_DOMAINS[net].some((d) => h.link.includes(d)));
    const ex = exclude.trim().toLowerCase();
    if (ex) r = r.filter((h) => !h.link.toLowerCase().includes(ex));
    if (onlyEng) r = r.filter((h) => h.likes > 0 || h.comments > 0);
    if (sort === "likes") r.sort((a, b) => b.likes - a.likes);
    else if (sort === "comments") r.sort((a, b) => b.comments - a.comments);
    else if (sort === "old") r.reverse();
    return r;
  }

  async function run(over?: { sort?: Sort }) {
    if (!q.trim()) return;
    const useSort = over?.sort ?? sort;
    setLoading(true);
    setErr("");
    setSummary(null);
    try {
      const query = net === "all" ? q : `${q} ${NET_HINT[net]}`;
      const tbsParts: string[] = [];
      if (period) tbsParts.push(`qdr:${period}`);
      if (useSort === "recent") tbsParts.push("sbd:1");
      const tbs = tbsParts.join(",");
      const k = serperKey().trim();
      const call = (endpoint: string, num: number) => invoke<Hit[]>("web_search", { query, key: k, endpoint, num, site: undefined, tbs });
      let r: Hit[];
      if (kind === "any") {
        // "Qualquer" = puxa de varios tipos e junta (dedup por link); os outros filtros mandam
        const arrs = await Promise.all(["search", "news", "videos"].map((ep) => call(ep, 20).catch(() => [] as Hit[])));
        const seen = new Set<string>();
        r = [];
        for (const a of arrs) for (const h of a) if (h.link && !seen.has(h.link)) { seen.add(h.link); r.push(h); }
      } else {
        r = await call(kind, 30);
      }
      const ranked: Ranked[] = r.map((h) => ({ ...h, likes: parseCount(h.snippet, "likes"), comments: parseCount(h.snippet, "comments") }));
      setHits(applyClient(ranked));
      setSentFilter("all");
    } catch (e) {
      setErr(String(e));
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  // ----- IA: sentimento em lote -----
  async function analyze(list?: Ranked[]) {
    const cur = list ?? hits;
    if (!cur?.length) return;
    setBusy(t("busca.analyzing"));
    setErr("");
    try {
      const top = cur.slice(0, 24);
      const user =
        `Alvo da busca: "${q}".\nItens:\n` +
        top.map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") +
        `\nResponda SO JSON: {"itens":[{"i":0,"s":"positivo|negativo|neutro"}]}`;
      const sys = "Voce e analista de campanha. Classifique o SENTIMENTO de cada item EM RELACAO ao alvo: positivo=elogio/apoio, negativo=critica/ataque/mentira, neutro=informativo. So JSON.";
      const raw = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: true });
      const data = JSON.parse(raw);
      const map: Record<number, Sent> = {};
      for (const it of data.itens || []) {
        const s = String(it.s || "").toLowerCase();
        map[it.i] = s.startsWith("pos") ? "pos" : s.startsWith("neg") ? "neg" : "neu";
      }
      const tagged = cur.map((h, i) => (i < 24 ? { ...h, sent: map[i] ?? h.sent } : h));
      setHits(tagged);
      return tagged;
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }

  // ----- Modo Crise: ordena por engajamento, busca, analisa, filtra negativos -----
  async function crisis() {
    setSort("likes");
    await run({ sort: "likes" });
    const tagged = await analyze();
    if (tagged) setSentFilter("neg");
  }

  // ----- IA: resumo de inteligência -----
  async function summarize() {
    if (!hits?.length) return;
    setBusy(t("busca.summarizing"));
    setErr("");
    try {
      const top = hits.slice(0, 20);
      const user =
        `Alvo: "${q}". Resultados:\n` +
        top.map((h, i) => `[${i}] ${h.title} (${h.source}${h.sent ? ", " + h.sent : ""}) — ${h.snippet}`).join("\n") +
        `\n\nEscreva em PT-BR, objetivo, SEM inventar:\n1) NARRATIVAS POSITIVAS (bullets)\n2) ATAQUES / MENTIRAS (bullets, e o que responder em cada)\n3) RESPOSTA URGENTE (1-3 itens que mais precisam)`;
      const sys = "Voce e analista de inteligencia de campanha. Resuma so com base nos resultados dados.";
      const text = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: false });
      setSummary(text);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }

  // ----- IA: gerador de resposta a um ataque/menção -----
  async function genReply(h: Ranked) {
    setReply({ h, text: "" });
    try {
      const sys = "Voce e assessor de comunicacao de campanha. Escreva uma resposta CURTA (2-3 frases), educada, por CONTEXTO e fatos, SEM atacar ninguem, pronta pra publicar. Tom institucional, PT-BR.";
      const user = `Alvo: "${q}". Publicacao a responder (${h.source}): "${h.title}. ${h.snippet}". Escreva a resposta.`;
      const text = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: false });
      setReply({ h, text });
    } catch (e) {
      setReply({ h, text: String(e) });
    }
  }

  // ----- Comparar candidatos: volume + % de ataque por termo -----
  async function compare() {
    const terms = cmp.input.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (terms.length < 2) return;
    setCmp((c) => ({ ...c, busy: t("busca.comparing"), rows: null }));
    try {
      const rows: { term: string; total: number; negPct: number; sample: string }[] = [];
      for (const term of terms) {
        const r = await invoke<Hit[]>("web_search", { query: term, key: serperKey().trim(), endpoint: "search", num: 20, site: undefined, tbs: "" });
        let negPct = 0, sample = "";
        if (r.length) {
          const user = `Alvo: "${term}".\nItens:\n` + r.slice(0, 15).map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") + `\nResponda SO JSON {"itens":[{"i":0,"s":"positivo|negativo|neutro"}]}`;
          try {
            const data = JSON.parse(await invoke<string>("ai_chat", { system: "Classifique sentimento EM RELACAO ao alvo. So JSON.", user, key: groqKey().trim(), json: true }));
            const negs = (data.itens || []).filter((x: { s: string }) => String(x.s).toLowerCase().startsWith("neg"));
            negPct = Math.round((negs.length / Math.max(1, (data.itens || []).length)) * 100);
            if (negs[0] != null) sample = r[negs[0].i]?.title || "";
          } catch { /* IA opcional */ }
        }
        rows.push({ term, total: r.length, negPct, sample });
      }
      setCmp((c) => ({ ...c, busy: "", rows }));
    } catch (e) {
      setErr(String(e));
      setCmp((c) => ({ ...c, busy: "" }));
    }
  }

  function dossier() {
    if (!hits?.length) return;
    const sLabel = (s?: Sent) => (s === "pos" ? "positivo" : s === "neg" ? "negativo" : s === "neu" ? "neutro" : "");
    const bytes = exportDossierPdf({
      title: t("busca.dossierTitle", { q }),
      subtitle: `${new Date().toLocaleString()} · ${hits.length} ${t("busca.results0")}`,
      summary: summary || "",
      rows: hits.map((h) => ({ title: h.title, link: h.link, source: h.source, date: h.date, sent: sLabel(h.sent), snippet: h.snippet })),
      colTitle: t("busca.dTitle"), colSource: t("busca.dSource"), colSent: t("busca.dSent"), colSnippet: t("busca.dSnippet"),
      summaryLabel: t("busca.summaryTitle"), footer: t("posts.pdfFooter", { date: new Date().toLocaleString() }),
    });
    saveBytes(bytes, `codexig-dossie-${q.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 24) || "busca"}.pdf`, "pdf", "PDF");
  }

  function exportCsv() {
    if (!hits?.length) return;
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const rows = ["titulo,link,fonte,data,sentimento,curtidas,comentarios,trecho"];
    hits.forEach((h) => rows.push([h.title, h.link, h.source, h.date, h.sent || "", String(h.likes), String(h.comments), h.snippet].map(esc).join(",")));
    saveBytes(new TextEncoder().encode("﻿" + rows.join("\r\n")), `codexig-busca.csv`, "csv", "CSV");
  }
  function copyList() {
    if (!hits?.length) return;
    navigator.clipboard.writeText(hits.map((h) => `${h.title}\n${h.link}`).join("\n\n"));
  }

  // ----- Monitor salvo -----
  function saveMonitor() {
    const v = q.trim();
    if (!v || presets.includes(v)) return;
    const next = [v, ...presets].slice(0, 12);
    setPresets(next);
    localStorage.setItem("codexig_monitor", JSON.stringify(next));
  }
  function delMonitor(p: string) {
    const next = presets.filter((x) => x !== p);
    setPresets(next);
    localStorage.setItem("codexig_monitor", JSON.stringify(next));
  }

  const shown = (hits || []).filter((h) => sentFilter === "all" || (sentFilter === "neg" ? h.sent === "neg" : h.sent === "pos"));
  const sentColor = (s?: Sent) => (s === "pos" ? "text-[#3ad07a]" : s === "neg" ? "text-[var(--color-coral2)]" : s === "neu" ? "text-[var(--color-slate)]" : "");

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
          <button onClick={() => run()} disabled={loading} className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">
            {loading ? t("busca.searching") : t("busca.search")}
          </button>
          <button onClick={saveMonitor} title={t("busca.saveMonitor")} className="shrink-0 rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-3 py-2.5 text-[13px] font-bold text-[var(--color-teal2)]">★</button>
        </div>

        {/* filtros */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Field label={t("busca.kind")}>
            <Select ariaLabel={t("busca.kind")} value={kind} onChange={(v) => setKind(v as Kind)} options={[
              { value: "any", label: t("busca.kAny") }, { value: "search", label: t("busca.kWeb") }, { value: "videos", label: t("busca.kVideos") }, { value: "images", label: t("busca.kImages") }, { value: "news", label: t("busca.kNews") }, { value: "places", label: t("busca.kPlaces") },
            ]} />
          </Field>
          <Field label={t("busca.net")}>
            <Select ariaLabel={t("busca.net")} value={net} onChange={(v) => setNet(v as Net)} options={[
              { value: "all", label: t("busca.nAll") }, { value: "instagram", label: "Instagram" }, { value: "facebook", label: "Facebook" }, { value: "x", label: "X / Twitter" }, { value: "youtube", label: "YouTube" }, { value: "tiktok", label: "TikTok" },
            ]} />
          </Field>
          <Field label={t("busca.period")}>
            <Select ariaLabel={t("busca.period")} value={period} onChange={(v) => setPeriod(v as Period)} options={[
              { value: "", label: t("busca.pAny") }, { value: "d", label: t("busca.p24h") }, { value: "w", label: t("busca.p7d") }, { value: "m", label: t("busca.pMonth") }, { value: "y", label: t("busca.pYear") },
            ]} />
          </Field>
          <Field label={t("busca.sort")}>
            <Select ariaLabel={t("busca.sort")} value={sort} onChange={(v) => setSort(v as Sort)} options={[
              { value: "rel", label: t("busca.sRel") }, { value: "recent", label: t("busca.sRecent") }, { value: "old", label: t("busca.sOld") }, { value: "likes", label: t("busca.sLikes") }, { value: "comments", label: t("busca.sComments") },
            ]} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder={t("busca.excludePh")} className="w-44 rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-1.5 text-[12px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-slate)]">
            <input type="checkbox" checked={onlyEng} onChange={(e) => setOnlyEng(e.target.checked)} className="accent-[var(--color-teal)]" />
            {t("busca.onlyEng")}
          </label>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-slate)]">{t("busca.tips")} · {t("busca.sortNote")}</p>

        {/* monitor salvo */}
        {presets.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("busca.monitor")}:</span>
            {presets.map((p) => (
              <span key={p} className="group inline-flex items-center gap-1 rounded-full border border-[var(--color-steel)] bg-[#0e1522] px-2.5 py-1 text-[12px]">
                <button onClick={() => { setQ(p); setTimeout(() => run(), 0); }} className="text-[var(--color-paper)] pii">{p}</button>
                <button onClick={() => delMonitor(p)} className="text-[var(--color-slate)] hover:text-[var(--color-coral2)]">×</button>
              </span>
            ))}
          </div>
        )}

        {/* barra de inteligência */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
          <button onClick={crisis} disabled={!!busy || loading} className="rounded-lg bg-[linear-gradient(135deg,#ff4d3d,#ff8a5c)] px-3.5 py-2 text-[12.5px] font-bold text-[#1a0a08] disabled:opacity-40">{t("busca.crisis")}</button>
          <button onClick={() => analyze()} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.analyze")}</button>
          <button onClick={summarize} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.summarize")}</button>
          <button onClick={dossier} disabled={!hits?.length} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-teal2)] disabled:opacity-40">{t("busca.dossier")}</button>
          <button onClick={() => setCmp((c) => ({ ...c, open: true }))} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)]">{t("busca.compare")}</button>
          {busy && <span className="self-center text-[12px] text-[var(--color-teal2)]">{busy}</span>}
        </div>
      </div>

      {err && <div className="rounded-xl border border-[#43221d] bg-[#1a0e0c] px-4 py-3 text-[13px] text-[var(--color-coral2)]">{err}</div>}

      {summary && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[var(--color-teal2)]">{t("busca.summaryTitle")}</span>
            <button onClick={() => setSummary(null)} className="text-[12px] text-[var(--color-slate)]">×</button>
          </div>
          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{summary}</p>
        </div>
      )}

      {loading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-20" />)}</div>}

      {!loading && hits && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[var(--color-slate)]">{t("busca.found", { n: nf(shown.length) })}</span>
              {hits.some((h) => h.sent) && (
                <div className="flex items-center gap-1 rounded-lg border border-[var(--color-line)] p-0.5">
                  {(["all", "neg", "pos"] as const).map((f) => (
                    <button key={f} onClick={() => setSentFilter(f)} className={"rounded px-2 py-0.5 text-[11.5px] font-bold " + (sentFilter === f ? "bg-[var(--color-teal)] text-[#04120f]" : "text-[var(--color-slate)]")}>
                      {f === "all" ? t("busca.fAll") : f === "neg" ? t("busca.fNeg") : t("busca.fPos")}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {hits.length > 0 && (
              <div className="flex gap-2">
                <button onClick={copyList} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.copy")}</button>
                <button onClick={exportCsv} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.exportCsv")}</button>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[#090d15] p-6 text-center text-[13px] text-[var(--color-slate)]">{t("busca.empty")}</div>
          ) : (
            <div className="stagger space-y-2">
              {shown.map((h, i) => (
                <div key={h.link + i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] transition hover:border-[var(--color-steel)]">
                  <a href={h.link} target="_blank" rel="noreferrer" className="flex gap-3 p-3">
                    {h.image ? <img src={h.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : null}
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-bold text-[var(--color-teal2)]">{h.title || h.link}</div>
                      <div className="flex flex-wrap items-center gap-x-2 truncate text-[11.5px] text-[var(--color-slate)]">
                        <span>{h.source}{h.date ? ` · ${h.date}` : ""}</span>
                        {h.sent ? <span className={"font-bold " + sentColor(h.sent)}>{h.sent === "pos" ? t("busca.sPos") : h.sent === "neg" ? t("busca.sNeg") : t("busca.sNeu")}</span> : null}
                        {h.likes > 0 ? <span className="text-[var(--color-teal2)]">{nf(h.likes)} {t("busca.likes")}</span> : null}
                        {h.comments > 0 ? <span className="text-[var(--color-teal2)]">{nf(h.comments)} {t("busca.comments")}</span> : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-ink)]">{h.snippet}</p>
                    </div>
                  </a>
                  <div className="flex justify-end border-t border-[var(--color-line)] px-3 py-1.5">
                    <button onClick={() => genReply(h)} className="text-[11.5px] font-bold text-[var(--color-teal2)] hover:underline">{t("busca.reply")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* modal: resposta gerada por IA */}
      {reply && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setReply(null)}>
          <div className="pop w-full max-w-lg rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.replyTitle")}</span>
              <button onClick={() => setReply(null)} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <div className="mb-2 truncate text-[11.5px] text-[var(--color-slate)] pii">{reply.h.title}</div>
            {reply.text ? (
              <>
                <p className="selectable whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[#090d15] p-3 text-[13px] leading-relaxed text-[var(--color-ink)]">{reply.text}</p>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => navigator.clipboard.writeText(reply.text)} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12px] font-bold text-[#04120f]">{t("busca.copyReply")}</button>
                  <button onClick={() => genReply(reply.h)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.regen")}</button>
                </div>
              </>
            ) : (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel h-4" />)}</div>
            )}
          </div>
        </div>
      )}

      {/* modal: comparar candidatos */}
      {cmp.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setCmp((c) => ({ ...c, open: false }))}>
          <div className="pop w-full max-w-2xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.compareTitle")}</span>
              <button onClick={() => setCmp((c) => ({ ...c, open: false }))} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <p className="mb-2 text-[12px] text-[var(--color-slate)]">{t("busca.compareHint")}</p>
            <div className="flex gap-2">
              <input value={cmp.input} onChange={(e) => setCmp((c) => ({ ...c, input: e.target.value }))} placeholder="Fúria, Marcos Rogério, Hildo" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
              <button onClick={compare} disabled={!!cmp.busy} className="shrink-0 rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2 text-[12.5px] font-bold text-[#04120f] disabled:opacity-40">{cmp.busy || t("busca.compareGo")}</button>
            </div>
            {cmp.rows && (
              <div className="mt-4 overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[var(--color-slate)]"><tr><th className="py-1.5">{t("busca.cTerm")}</th><th>{t("busca.cVol")}</th><th>{t("busca.cNeg")}</th><th>{t("busca.cSample")}</th></tr></thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.term} className="border-t border-[var(--color-line)] align-top">
                        <td className="py-1.5 font-bold text-[var(--color-paper)]">{r.term}</td>
                        <td className="tabular-nums">{r.total}</td>
                        <td className={"tabular-nums font-bold " + (r.negPct >= 40 ? "text-[var(--color-coral2)]" : "text-[var(--color-slate)]")}>{r.negPct}%</td>
                        <td className="text-[var(--color-slate)]">{r.sample || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{label}</span>
      {children}
    </div>
  );
}
