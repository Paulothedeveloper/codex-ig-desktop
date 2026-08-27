import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { Select } from "../Select";
import AnimatedOverlay from "../AnimatedOverlay";
import Help from "../Help";
import Loading from "../Loading";
import { exportDossierPdf } from "../pdf";

type Hit = { title: string; link: string; snippet: string; source: string; date: string; image: string };
type Sent = "pos" | "neg" | "neu";
type Ranked = Hit & { likes: number; comments: number; sent?: Sent };
type Kind = "any" | "search" | "videos" | "images" | "news" | "places";
type Net = "all" | "instagram" | "facebook" | "x" | "youtube" | "tiktok";
type Period = "" | "d" | "w" | "m" | "y";
type Sort = "rel" | "recent" | "old" | "likes" | "comments";
type Voice = { name: string; handle: string; kind: string; mentions: number; reach: string; stance: Sent; why: string };
// Segmentação regional — campanha é Rondônia. loc = string canônica do Google (Serper location); term = reforço na query.
const REGIONS: { label: string; loc: string; term: string }[] = [
  { label: "Rondônia", loc: "State of Rondonia, Brazil", term: "Rondônia" },
  { label: "Porto Velho", loc: "Porto Velho, State of Rondonia, Brazil", term: "Porto Velho" },
  { label: "Ji-Paraná", loc: "Ji-Parana, State of Rondonia, Brazil", term: "Ji-Paraná" },
  { label: "Ariquemes", loc: "Ariquemes, State of Rondonia, Brazil", term: "Ariquemes" },
  { label: "Vilhena", loc: "Vilhena, State of Rondonia, Brazil", term: "Vilhena" },
  { label: "Cacoal", loc: "Cacoal, State of Rondonia, Brazil", term: "Cacoal" },
  { label: "Rolim de Moura", loc: "Rolim de Moura, State of Rondonia, Brazil", term: "Rolim de Moura" },
  { label: "Guajará-Mirim", loc: "Guajara-Mirim, State of Rondonia, Brazil", term: "Guajará-Mirim" },
];

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

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type IComment = { user: IgUser; text: string; likes: number; created_at: number };

// shortcode do IG -> media_id (base64 do proprio IG). Determinístico, sem request.
const IG_AB = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function shortcodeToId(sc: string): string | null {
  let n = 0n;
  for (const c of sc) { const i = IG_AB.indexOf(c); if (i < 0) return null; n = n * 64n + BigInt(i); }
  return n.toString();
}
function igShortcode(link: string): string | null {
  const m = link.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// histórico de buscas (volume + % de ataque no tempo) — acumula no localStorage
type HistEntry = { term: string; ts: number; count: number; neg?: number };
const loadHist = (): HistEntry[] => JSON.parse(localStorage.getItem("codexig_history") || "[]");
function pushHist(e: HistEntry) { localStorage.setItem("codexig_history", JSON.stringify([...loadHist(), e].slice(-300))); }
function updateLastNeg(term: string, neg: number) {
  const h = loadHist();
  for (let i = h.length - 1; i >= 0; i--) if (h[i].term === term) { h[i].neg = neg; break; }
  localStorage.setItem("codexig_history", JSON.stringify(h));
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
  const [wide, setWide] = useState(false);
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);
  const [sentFilter, setSentFilter] = useState<"all" | "neg" | "pos">("all");
  const [deep, setDeep] = useState<{ title: string; text: string } | null>(null);
  const [narr, setNarr] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceFilter, setVoiceFilter] = useState<"all" | "pos" | "neg">("all");

  const [hits, setHits] = useState<Ranked[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [presets, setPresets] = useState<string[]>(JSON.parse(localStorage.getItem("codexig_monitor") || "[]"));
  const [reply, setReply] = useState<{ h: Ranked; text: string } | null>(null);
  const [inter, setInter] = useState<{ title: string; loading: boolean; err: string; likers: IgUser[]; comments: IComment[] } | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [cmp, setCmp] = useState<{ open: boolean; input: string; busy: string; rows: { term: string; total: number; negPct: number; sample: string }[] | null }>({ open: false, input: "", busy: "", rows: null });
  // Estratégia: checagem de boato, dossiê do adversário, radar de temas, briefing
  const [strat, setStrat] = useState<{ kind: "check" | "dossier" | "radar" | "briefing"; input: string; busy: boolean; out: string; rows: Ranked[] } | null>(null);

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

  // 1 termo -> Hit[] (respeita o tipo "Qualquer" = varios endpoints), na pagina pg
  async function fetchQuery(query: string, pg: number, k: string, tbs: string): Promise<Hit[]> {
    const loc = REGIONS.find((r) => r.label === region)?.loc;
    const call = (endpoint: string, num: number) => invoke<Hit[]>("web_search", { query, key: k, endpoint, num, site: undefined, tbs, page: pg, location: loc });
    if (kind === "any") {
      const arrs = await Promise.all(["search", "news", "videos"].map((ep) => call(ep, 20).catch(() => [] as Hit[])));
      return arrs.flat();
    }
    return call(kind, 30);
  }

  // Busca ampliada: IA gera variações do termo (apelido, cargo, nome completo, hashtag)
  async function expand(base: string): Promise<string[]> {
    try {
      const raw = await invoke<string>("ai_chat", { system: "Gere variacoes de busca. So JSON.", user: `Termo: "${base}". Gere 3 variacoes/sinonimos uteis pra achar MAIS mencoes (apelido, cargo/funcao, nome completo, hashtag). So JSON {"q":["...","...","..."]}`, key: groqKey().trim(), json: true });
      const d = JSON.parse(raw);
      return (d.q || []).filter((x: unknown) => typeof x === "string").slice(0, 3);
    } catch { return []; }
  }

  async function run(over?: { sort?: Sort; page?: number }) {
    if (!q.trim()) return;
    const useSort = over?.sort ?? sort;
    const pg = over?.page ?? 1;
    setLoading(true);
    setErr("");
    if (pg === 1) { setSummary(null); setNarr(null); setVoices(null); }
    try {
      const rterm = REGIONS.find((r) => r.label === region)?.term;
      const withNet = (s: string) => {
        let out = net === "all" ? s : `${s} ${NET_HINT[net]}`;
        if (rterm && !s.toLowerCase().includes(rterm.toLowerCase())) out = `${out} ${rterm}`;
        return out;
      };
      const tbsParts: string[] = [];
      if (period) tbsParts.push(`qdr:${period}`);
      if (useSort === "recent") tbsParts.push("sbd:1");
      const tbs = tbsParts.join(",");
      const k = serperKey().trim();
      let queries = [withNet(q)];
      if (wide && pg === 1) { const ex = await expand(q); queries = [withNet(q), ...ex.map(withNet)]; }
      const arrs = await Promise.all(queries.map((qq) => fetchQuery(qq, pg, k, tbs)));
      // dedup por link (contra o que já está na tela, se paginando)
      const seen = new Set<string>();
      if (pg > 1 && hits) for (const h of hits) seen.add(h.link);
      const fresh: Hit[] = [];
      for (const a of arrs) for (const h of a) if (h.link && !seen.has(h.link)) { seen.add(h.link); fresh.push(h); }
      const ranked: Ranked[] = fresh.map((h) => ({ ...h, likes: parseCount(h.snippet, "likes"), comments: parseCount(h.snippet, "comments") }));
      const filtered = applyClient(ranked);
      const next = pg > 1 && hits ? [...hits, ...filtered] : filtered;
      setHits(next);
      if (pg === 1) setSentFilter("all");
      setPage(pg);
      pushHist({ term: q.trim(), ts: Date.now(), count: (pg > 1 && hits ? hits.length : 0) + filtered.length });
      return next; // devolve os hits frescos (evita ler estado stale em quem encadeia, ex. Modo Crise)
    } catch (e) {
      setErr(String(e));
      if (pg === 1) setHits(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  // ----- Leitura profunda: le a PAGINA inteira e a IA diz o que diz de fato -----
  async function readDeep(h: Ranked) {
    setDeep({ title: h.title, text: "" });
    try {
      const raw = await invoke<string>("fetch_page", { url: h.link });
      const text = raw.slice(0, 6000);
      const out = await invoke<string>("ai_chat", { system: "Voce e analista de campanha. Resuma o que o conteudo diz DE FATO sobre o alvo, em 3-5 frases, e o tom (apoio/ataque/neutro). PT-BR, sem inventar.", user: `Alvo: "${q}".\nConteudo da pagina:\n${text}`, key: groqKey().trim(), json: false });
      setDeep({ title: h.title, text: out });
    } catch (e) {
      setDeep({ title: h.title, text: String(e) });
    }
  }

  // ----- Narrativas: IA agrupa os resultados nos principais temas/narrativas -----
  async function narratives() {
    if (!hits?.length) return;
    setBusy(t("busca.narrating"));
    setErr("");
    try {
      const top = hits.slice(0, 24);
      const user = `Alvo: "${q}". Resultados:\n` + top.map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") + `\n\nAgrupe nas 3-6 PRINCIPAIS narrativas/temas que estao circulando. Pra cada: titulo curto, quantos itens, tom (apoio/ataque/neutro) e 1 frase. PT-BR.`;
      const out = await invoke<string>("ai_chat", { system: "Voce e analista de narrativa de campanha (tipo war room). So com base nos resultados.", user, key: groqKey().trim(), json: false });
      setNarr(out);
    } catch (e) { setErr(String(e)); } finally { setBusy(""); }
  }

  // ----- Vozes: IA descobre quem MOVE a conversa (perfis/veiculos/canais) -----
  async function findVoices() {
    if (!hits?.length) return;
    setBusy(t("busca.voicesFinding"));
    setErr("");
    try {
      const top = hits.slice(0, 30);
      const user =
        `Alvo: "${q}". Resultados (titulo | fonte | link | trecho):\n` +
        top.map((h, i) => `[${i}] ${h.title} | ${h.source} | ${h.link} | ${h.snippet}`).join("\n") +
        `\n\nIdentifique as VOZES que MOVEM esta conversa: perfis (@ do Instagram/X/TikTok), veiculos de noticia, canais do YouTube, autores. ` +
        `Ordene pelas mais influentes/recorrentes. Responda SO JSON: {"vozes":[{"nome":"","handle":"@ ou dominio","tipo":"perfil|veiculo|canal|autor","mencoes":1,"alcance":"alto|medio|nano/local","stance":"apoio|ataque|neutro","porque":"1 frase curta"}]}`;
      const sys = "Voce e analista de social listening de campanha (tipo Brandwatch/Meltwater). Mapeie os influenciadores/veiculos que dirigem a conversa, SO com base nos resultados. Nao invente contas que nao aparecem.";
      const raw = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: true });
      const data = JSON.parse(raw);
      const list: Voice[] = (data.vozes || []).map((v: any) => {
        const st = String(v.stance || "").toLowerCase();
        return {
          name: String(v.nome || v.handle || "?"),
          handle: String(v.handle || ""),
          kind: String(v.tipo || ""),
          mentions: Number(v.mencoes) || 0,
          reach: String(v.alcance || ""),
          stance: st.startsWith("apoi") || st.startsWith("pos") ? "pos" : st.startsWith("ataq") || st.startsWith("neg") ? "neg" : "neu",
          why: String(v.porque || ""),
        };
      });
      setVoices(list);
    } catch (e) { setErr(String(e)); } finally { setBusy(""); }
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
      const withSent = tagged.filter((h) => h.sent);
      if (withSent.length) updateLastNeg(q.trim(), Math.round((withSent.filter((h) => h.sent === "neg").length / withSent.length) * 100));
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
    const fresh = await run({ sort: "likes" }); // usa o retorno, não o estado (stale)
    if (!fresh?.length) return;
    const tagged = await analyze(fresh);
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

  // ----- Cruzar Busca -> Posts: quem curtiu/comentou o post do IG (quem esta por tras) -----
  async function openInteract(h: Ranked) {
    const sc = igShortcode(h.link);
    const id = sc ? shortcodeToId(sc) : null;
    if (!id) { setErr(t("busca.noPost")); return; }
    setInter({ title: h.title, loading: true, err: "", likers: [], comments: [] });
    try {
      const [likers, comments] = await Promise.all([
        invoke<IgUser[]>("ig_likers", { mediaId: id }),
        invoke<IComment[]>("ig_comments", { mediaId: id }),
      ]);
      setInter({ title: h.title, loading: false, err: "", likers, comments });
    } catch (e) {
      setInter({ title: h.title, loading: false, err: String(e), likers: [], comments: [] });
    }
  }

  // ----- IA: gerador de resposta a um ataque/menção -----
  async function genReply(h: Ranked) {
    setReply({ h, text: "" });
    try {
      const sys = "Voce e assessor de comunicacao de campanha. Gere respostas prontas pra publicar, curtas (2-3 frases), por CONTEXTO e fatos, SEM atacar ninguem. PT-BR.";
      const user = `Alvo: "${q}". Publicacao a responder (${h.source}): "${h.title}. ${h.snippet}".\n\nEscreva 3 VERSOES da resposta, cada uma rotulada em MAIUSCULO na primeira linha:\nINSTITUCIONAL — tom formal, nota oficial.\nDIRETO — firme, rebate o ponto com fato.\nEMPATICO — proximo, humano, acolhe a preocupacao.\nUma linha em branco entre elas.`;
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

  // ----- Estratégia (checagem / dossiê adversário / radar / briefing) -----
  function openStrat(kind: "check" | "dossier" | "radar" | "briefing") {
    setStrat({ kind, input: "", busy: false, out: "", rows: [] });
  }
  async function runStrat() {
    if (!strat) return;
    const k = strat.kind;
    if ((k === "check" || k === "dossier") && !strat.input.trim()) return;
    setStrat((s) => s && { ...s, busy: true, out: "" });
    try {
      const sk = serperKey().trim();
      const search = async (query: string, tbs = ""): Promise<Ranked[]> => {
        const hs = await invoke<Hit[]>("web_search", { query, key: sk, endpoint: "search", num: 10, tbs });
        return hs.map((h) => ({ ...h, likes: 0, comments: 0 }));
      };
      let rows: Ranked[] = [];
      let sys = "", user = "";
      if (k === "check") {
        rows = await search(strat.input);
        sys = "Voce e checador de fatos imparcial. So com base nas fontes dadas, sem opiniao.";
        user = `Alegacao a checar: "${strat.input}".\nFontes:\n` + rows.slice(0, 10).map((h, i) => `[${i}] ${h.title} — ${h.snippet} (${h.source})`).join("\n") + `\n\nResponda PT-BR, exatamente:\nVEREDITO: PROCEDE | FALSO | ENGANOSO | SEM PROVA\nPORQUE: 2-3 frases com base nas fontes\nRESPOSTA PRONTA: uma frase curta pra publicar esclarecendo`;
      } else if (k === "dossier") {
        const n = strat.input;
        const [a, b, c] = await Promise.all([search(n), search(`${n} critica OR ataque OR polemica`), search(`${n} promessa OR proposta`)]);
        rows = [...a, ...b, ...c];
        sys = "Voce e analista de inteligencia politica. So com base nas fontes, sem inventar.";
        user = `Alvo: "${n}". Fontes:\n` + rows.slice(0, 24).map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") + `\n\nMonte um DOSSIE em PT-BR:\n1) QUEM E (cargo/partido se aparecer)\n2) NARRATIVAS (a favor e contra)\n3) ATAQUES / VULNERABILIDADES que ele sofre\n4) PROMESSAS / POSICOES`;
      } else if (k === "radar") {
        const reg = REGIONS.find((r) => r.label === region)?.term || "Rondonia";
        rows = await search(`${reg} politica`, "qdr:d,sbd:1");
        sys = "Voce e analista de pauta politica. So com base nas noticias dadas.";
        user = `Regiao: "${reg}". Noticias recentes:\n` + rows.slice(0, 12).map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") + `\n\nListe os 5-8 TEMAS MAIS QUENTES agora, do mais pro menos relevante. Pra cada: titulo curto + 1 frase + por que importa pra campanha. PT-BR.`;
      } else {
        const term = q.trim() || strat.input.trim();
        if (!term) { setStrat((s) => s && { ...s, busy: false, out: t("busca.stratBriefNeed") }); return; }
        rows = await search(term, "qdr:d,sbd:1");
        sys = "Voce e chefe de gabinete montando o briefing matinal da campanha. So com base nos resultados.";
        user = `Alvo: "${term}". Ultimas 24h:\n` + rows.slice(0, 15).map((h, i) => `[${i}] ${h.title} — ${h.snippet}`).join("\n") + `\n\nMonte o BRIEFING DE HOJE em PT-BR:\n- CLIMA GERAL (1 linha)\n- NOVOS ATAQUES / RISCOS (bullets)\n- OPORTUNIDADES (bullets)\n- TOP 3 PRA RESPONDER HOJE (prioridade)`;
      }
      const out = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: false });
      setStrat((s) => s && { ...s, busy: false, out, rows });
    } catch (e) {
      setStrat((s) => s && { ...s, busy: false, out: String(e) });
    }
  }
  function stratPdf() {
    if (!strat?.out) return;
    const bytes = exportDossierPdf({
      title: strat.kind === "dossier" ? t("busca.stratDossier") + ": " + strat.input : t("busca.strat" + (strat.kind === "check" ? "Check" : strat.kind === "radar" ? "Radar" : "Brief")),
      subtitle: new Date().toLocaleString(),
      summary: strat.out, summaryLabel: t("busca.summaryTitle"),
      rows: strat.rows.map((h) => ({ title: h.title, link: h.link, source: h.source, date: h.date, sent: "", snippet: h.snippet })),
      colTitle: t("busca.dTitle"), colSource: t("busca.dSource"), colSent: t("busca.dSent"), colSnippet: t("busca.dSnippet"),
      footer: t("posts.pdfFooter", { date: new Date().toLocaleString() }),
    });
    saveBytes(bytes, `codexig-${strat.kind}-${(strat.input || "campanha").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 20)}.pdf`, "pdf", "PDF");
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
        <div className="mb-3 flex items-start gap-1.5">
          <p className="text-[13px] text-[var(--color-slate)] leading-snug">{t("busca.intro")}</p>
          <Help label={t("busca.title")} text={t("help.busca")} />
        </div>
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
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-slate)]" title={t("busca.wideHint")}>
            <input type="checkbox" checked={wide} onChange={(e) => setWide(e.target.checked)} className="accent-[var(--color-teal)]" />
            {t("busca.wide")}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("busca.region")}: <Help label={t("busca.region")} text={t("help.region")} /></span>
          <button onClick={() => setRegion("")} className={`rounded-full border px-2.5 py-1 text-[12px] ${region === "" ? "border-[var(--color-teal)] bg-[var(--color-teal)]/15 text-[var(--color-teal2)]" : "border-[var(--color-steel)] bg-[#0e1522] text-[var(--color-slate)]"}`}>{t("busca.regionAll")}</button>
          {REGIONS.map((r) => (
            <button key={r.label} onClick={() => setRegion(r.label)} className={`rounded-full border px-2.5 py-1 text-[12px] ${region === r.label ? "border-[var(--color-teal)] bg-[var(--color-teal)]/15 text-[var(--color-teal2)]" : "border-[var(--color-steel)] bg-[#0e1522] text-[var(--color-paper)]"}`}>{r.label}</button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-slate)]">{t("busca.tips")} · {t("busca.sortNote")} · {t("busca.regionNote")}</p>

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
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-[var(--color-teal2)]">{t("busca.intelBar")} <Help label={t("busca.intelBar")} text={t("help.intel")} /></span>
          <button onClick={crisis} disabled={loading} className="rounded-lg bg-[linear-gradient(135deg,#ff4d3d,#ff8a5c)] px-3.5 py-2 text-[12.5px] font-bold text-[#1a0a08] disabled:opacity-40">{t("busca.crisis")}</button>
          <button onClick={() => analyze()} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.analyze")}</button>
          <button onClick={summarize} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.summarize")}</button>
          <button onClick={dossier} disabled={!hits?.length} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-teal2)] disabled:opacity-40">{t("busca.dossier")}</button>
          <button onClick={() => setCmp((c) => ({ ...c, open: true }))} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)]">{t("busca.compare")}</button>
          <button onClick={narratives} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.narratives")}</button>
          <button onClick={findVoices} disabled={!hits?.length || !!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)] disabled:opacity-40">{t("busca.voices")}</button>
          <button onClick={() => setHistOpen(true)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)]">{t("busca.history")}</button>
          {busy && <span className="self-center text-[12px] text-[var(--color-teal2)]">{busy}</span>}
        </div>

        {/* barra de estratégia (geradores) */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-[#c4b5fd]">{t("busca.stratBar")} <Help label={t("busca.stratBar")} text={t("help.strat")} /></span>
          <button onClick={() => openStrat("check")} className="rounded-lg border border-[#7c3aed]/50 bg-[#160f2b] px-3.5 py-2 text-[12.5px] font-bold text-[#c4b5fd]">{t("busca.stratCheck")}</button>
          <button onClick={() => openStrat("dossier")} className="rounded-lg border border-[#7c3aed]/50 bg-[#160f2b] px-3.5 py-2 text-[12.5px] font-bold text-[#c4b5fd]">{t("busca.stratDossier")}</button>
          <button onClick={() => openStrat("radar")} className="rounded-lg border border-[#7c3aed]/50 bg-[#160f2b] px-3.5 py-2 text-[12.5px] font-bold text-[#c4b5fd]">{t("busca.stratRadar")}</button>
          <button onClick={() => openStrat("briefing")} className="rounded-lg border border-[#7c3aed]/50 bg-[#160f2b] px-3.5 py-2 text-[12.5px] font-bold text-[#c4b5fd]">{t("busca.stratBrief")}</button>
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

      {loading && <Loading label={t("busca.searching")} steps={[t("busca.step1"), t("busca.step2"), t("busca.step3")]} skeleton={4} />}

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
                <div key={h.link + i} className="lift rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] hover:border-[var(--color-steel)]">
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
                  <div className="flex justify-end gap-3 border-t border-[var(--color-line)] px-3 py-1.5">
                    <button onClick={() => readDeep(h)} className="text-[11.5px] font-bold text-[var(--color-teal2)] hover:underline">{t("busca.readDeep")}</button>
                    {igShortcode(h.link) ? <button onClick={() => openInteract(h)} className="text-[11.5px] font-bold text-[var(--color-teal2)] hover:underline">{t("busca.whoInteracted")}</button> : null}
                    <button onClick={() => genReply(h)} className="text-[11.5px] font-bold text-[var(--color-teal2)] hover:underline">{t("busca.reply")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {shown.length > 0 && (
            <button onClick={() => run({ page: page + 1 })} disabled={loading} className="w-full rounded-xl border border-[var(--color-steel)] bg-[#0e1522] py-2.5 text-[13px] font-bold text-[var(--color-paper)] hover:border-[var(--color-teal)] disabled:opacity-50">{loading ? t("busca.searching") : t("busca.more")}</button>
          )}
        </div>
      )}

      {/* painel: narrativas (IA) */}
      {narr && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[var(--color-teal2)]">{t("busca.narrTitle")}</span>
            <button onClick={() => setNarr(null)} className="text-[12px] text-[var(--color-slate)]">×</button>
          </div>
          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{narr}</p>
        </div>
      )}

      {/* painel: vozes / micro-influencers (IA) */}
      {voices && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[var(--color-teal2)]">{t("busca.voicesTitle")}</span>
            <button onClick={() => setVoices(null)} className="text-[12px] text-[var(--color-slate)]">×</button>
          </div>
          {voices.length === 0 ? (
            <p className="text-[13px] text-[var(--color-slate)]">{t("busca.voicesEmpty")}</p>
          ) : (
            <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {([["all", t("busca.voiceAll")], ["pos", t("busca.voiceAllies")], ["neg", t("busca.voiceAttackers")]] as const).map(([v, lbl]) => (
                <button key={v} onClick={() => setVoiceFilter(v)} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${voiceFilter === v ? "border-[var(--color-teal)] bg-[var(--color-teal)]/15 text-[var(--color-teal2)]" : "border-[var(--color-steel)] bg-[#0e1522] text-[var(--color-slate)]"}`}>{lbl} <span className="tabular-nums opacity-70">{v === "all" ? voices.length : voices.filter((x) => x.stance === v).length}</span></button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {voices.filter((v) => voiceFilter === "all" || v.stance === voiceFilter).map((v, i) => {
                const sc = v.stance === "pos" ? "var(--color-teal2)" : v.stance === "neg" ? "var(--color-coral2)" : "var(--color-slate)";
                const sl = v.stance === "pos" ? t("busca.stanceSupport") : v.stance === "neg" ? t("busca.stanceAttack") : t("busca.stanceNeutral");
                return (
                  <div key={i} className="lift rounded-xl border border-[var(--color-line)] bg-[#0e1522] px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-bold text-[var(--color-paper)]">{v.name}</span>
                      {v.handle && <span className="text-[12px] text-[var(--color-slate)]">{v.handle}</span>}
                      {v.kind && <span className="rounded border border-[var(--color-steel)] px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-[var(--color-slate)]">{v.kind}</span>}
                      {v.reach && <span className="rounded border border-[var(--color-steel)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-slate)]">{v.reach}</span>}
                      <span className="rounded px-1.5 py-0.5 text-[10.5px] font-bold" style={{ color: sc, borderColor: sc, borderWidth: 1 }}>{sl}</span>
                      {v.mentions > 0 && <span className="ml-auto text-[11px] text-[var(--color-slate)]">{v.mentions}×</span>}
                    </div>
                    {v.why && <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink)]">{v.why}</p>}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      )}

      {/* modal: leitura profunda (IA lê a página inteira) */}
      <AnimatedOverlay data={deep} onClose={() => setDeep(null)} z={40}>
        {(d) => (
          <div className="w-full max-w-lg rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.readDeepTitle")}</span>
              <button onClick={() => setDeep(null)} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <div className="mb-2 truncate text-[11.5px] text-[var(--color-slate)] pii">{d.title}</div>
            {d.text ? (
              <p className="selectable whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[#090d15] p-3 text-[13px] leading-relaxed text-[var(--color-ink)]">{d.text}</p>
            ) : (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel h-4" />)}<p className="pt-1 text-[11px] text-[var(--color-slate)]">{t("busca.reading")}</p></div>
            )}
          </div>
        )}
      </AnimatedOverlay>

      {/* modal: resposta gerada por IA */}
      <AnimatedOverlay data={reply} onClose={() => setReply(null)} z={40}>
        {(r) => (
          <div className="w-full max-w-lg rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.replyTitle")}</span>
              <button onClick={() => setReply(null)} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <div className="mb-2 truncate text-[11.5px] text-[var(--color-slate)] pii">{r.h.title}</div>
            {r.text ? (
              <>
                <p className="selectable whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[#090d15] p-3 text-[13px] leading-relaxed text-[var(--color-ink)]">{r.text}</p>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => navigator.clipboard.writeText(r.text)} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12px] font-bold text-[#04120f]">{t("busca.copyReply")}</button>
                  <button onClick={() => genReply(r.h)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.regen")}</button>
                </div>
              </>
            ) : (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel h-4" />)}</div>
            )}
          </div>
        )}
      </AnimatedOverlay>

      {/* modal: estratégia (checagem / dossiê / radar / briefing) */}
      <AnimatedOverlay data={strat} onClose={() => setStrat(null)} z={40}>
        {(s) => (
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[#7c3aed]/40 bg-[var(--color-panel)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#c4b5fd]">{t("busca.strat" + (s.kind === "check" ? "Check" : s.kind === "dossier" ? "Dossier" : s.kind === "radar" ? "Radar" : "Brief"))}</span>
              <button onClick={() => setStrat(null)} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <p className="mb-2 text-[12px] leading-snug text-[var(--color-slate)]">{t("busca.stratHint." + s.kind)}</p>
            {(s.kind === "check" || s.kind === "dossier") && (
              <div className="mb-3 flex gap-2">
                <input value={s.input} onChange={(e) => setStrat((p) => p && { ...p, input: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") runStrat(); }}
                  placeholder={t("busca.stratPh." + s.kind)} className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none focus:border-[#a855f7]" />
                <button onClick={runStrat} disabled={s.busy || !s.input.trim()} className="shrink-0 rounded-lg bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-40">{s.busy ? t("busca.stratRunning") : t("busca.stratGo")}</button>
              </div>
            )}
            {(s.kind === "radar" || s.kind === "briefing") && !s.out && !s.busy && (
              <button onClick={runStrat} className="mb-3 self-start rounded-lg bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-4 py-2 text-[12.5px] font-bold text-white">{t("busca.stratGo")}</button>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {s.busy ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-4" />)}<p className="pt-1 text-[11px] text-[var(--color-slate)]">{t("busca.stratRunning")}</p></div>
              ) : s.out ? (
                <p className="selectable whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-[#090d15] p-3 text-[13px] leading-relaxed text-[var(--color-ink)]">{s.out}</p>
              ) : null}
            </div>
            {s.out && !s.busy && (
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => navigator.clipboard.writeText(s.out)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.copyReply")}</button>
                <button onClick={stratPdf} className="rounded-lg bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-3.5 py-2 text-[12px] font-bold text-white">{t("busca.stratPdf")}</button>
              </div>
            )}
          </div>
        )}
      </AnimatedOverlay>

      {/* modal: quem curtiu/comentou o post do IG (cruzar Busca -> Posts) */}
      <AnimatedOverlay data={inter} onClose={() => setInter(null)} z={40}>
        {(it) => (
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.whoTitle")}</span>
              <button onClick={() => setInter(null)} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <div className="mb-2 truncate text-[11.5px] text-[var(--color-slate)] pii">{it.title}</div>
            {it.loading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel h-8" />)}</div>
            ) : it.err ? (
              <div className="rounded-lg border border-[#43221d] bg-[#1a0e0c] p-3 text-[12.5px] text-[var(--color-coral2)]">{it.err}<div className="mt-1 text-[11px] text-[var(--color-slate)]">{t("busca.whoErrHint")}</div></div>
            ) : (
              <div className="selectable min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-2">
                <div className="mb-1 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("posts.whoLiked")} ({nf(it.likers.length)})</div>
                {it.likers.map((u) => (
                  <a key={u.pk} href={`https://instagram.com/${u.username}`} target="_blank" rel="noreferrer" className="flex items-baseline gap-2 rounded px-1.5 py-1 hover:bg-white/5">
                    <span className="text-[13px] pii">@{u.username}</span>{u.full ? <span className="truncate text-[12px] text-[var(--color-slate)] pii">· {u.full}</span> : null}
                  </a>
                ))}
                <div className="mb-1 mt-3 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("posts.whoCommented")} ({nf(it.comments.length)})</div>
                {it.comments.map((c, i) => (
                  <div key={c.user.pk + i} className="rounded px-1.5 py-1">
                    <a href={`https://instagram.com/${c.user.username}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold pii">@{c.user.username}</a>
                    <p className="text-[12px] text-[var(--color-slate)] pii">{c.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </AnimatedOverlay>

      {/* modal: histórico / timeline */}
      <AnimatedOverlay data={histOpen ? {} : null} onClose={() => setHistOpen(false)} z={40}>
        {() => {
          const hist = loadHist();
          const byTerm: Record<string, HistEntry[]> = {};
          for (const e of hist) (byTerm[e.term] = byTerm[e.term] || []).push(e);
          const terms = Object.keys(byTerm).reverse();
          const dt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
          return (
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.historyTitle")}</span>
                <div className="flex gap-2">
                  <button onClick={() => { localStorage.removeItem("codexig_history"); setHistOpen(false); }} className="text-[12px] text-[var(--color-slate)] hover:text-[var(--color-coral2)]">{t("busca.clearHist")}</button>
                  <button onClick={() => setHistOpen(false)} className="text-[13px] text-[var(--color-slate)]">×</button>
                </div>
              </div>
              {terms.length === 0 ? (
                <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("busca.histEmpty")}</p>
              ) : (
                <div className="min-h-0 flex-1 space-y-4 overflow-auto">
                  {terms.map((term) => {
                    const es = byTerm[term].slice(-24);
                    const max = Math.max(1, ...es.map((e) => e.count));
                    const last = es[es.length - 1];
                    return (
                      <div key={term} className="rounded-xl border border-[var(--color-line)] bg-[#090d15] p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="truncate text-[13px] font-bold text-[var(--color-paper)] pii">{term}</span>
                          <span className="text-[11.5px] text-[var(--color-slate)]">{es.length} {t("busca.histRuns")}{last.neg != null ? ` · ${last.neg}% ${t("busca.sNeg")}` : ""}</span>
                        </div>
                        <div className="flex items-end gap-1" style={{ height: 44 }}>
                          {es.map((e, i) => (
                            <div key={i} title={`${dt(e.ts)} · ${e.count}${e.neg != null ? ` · ${e.neg}% ataque` : ""}`}
                              className="w-full min-w-[4px] rounded-sm"
                              style={{ height: `${Math.max(8, (e.count / max) * 44)}px`, background: e.neg != null && e.neg >= 40 ? "var(--color-coral)" : "var(--color-teal-dim)" }} />
                          ))}
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] text-[var(--color-slate)]"><span>{dt(es[0].ts)}</span><span>{dt(last.ts)}</span></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }}
      </AnimatedOverlay>

      {/* modal: comparar candidatos */}
      <AnimatedOverlay data={cmp.open ? cmp : null} onClose={() => setCmp((c) => ({ ...c, open: false }))} z={40}>
        {(cm) => (
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--color-teal2)]">{t("busca.compareTitle")}</span>
              <button onClick={() => setCmp((c) => ({ ...c, open: false }))} className="text-[13px] text-[var(--color-slate)]">×</button>
            </div>
            <p className="mb-2 text-[12px] text-[var(--color-slate)]">{t("busca.compareHint")}</p>
            <div className="flex gap-2">
              <input value={cm.input} onChange={(e) => setCmp((c) => ({ ...c, input: e.target.value }))} placeholder="Fúria, Marcos Rogério, Hildo" className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
              <button onClick={compare} disabled={!!cm.busy} className="shrink-0 rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2 text-[12.5px] font-bold text-[#04120f] disabled:opacity-40">{cm.busy || t("busca.compareGo")}</button>
            </div>
            {cm.rows && (() => {
              const totalVol = cm.rows.reduce((s, r) => s + r.total, 0) || 1;
              const palette = ["#00e5c9", "#ff8a5c", "#7c9cff", "#ffd166"];
              return (
                <>
                  <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-[#0e1522] p-3.5">
                    <div className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-teal2)]">{t("busca.shareTitle")}</div>
                    <div className="flex flex-col gap-2">
                      {cm.rows.map((r, i) => {
                        const share = Math.round((r.total / totalVol) * 100);
                        return (
                          <div key={r.term}>
                            <div className="mb-0.5 flex items-baseline justify-between text-[12px]">
                              <span className="font-bold text-[var(--color-paper)] pii">{r.term}</span>
                              <span className="tabular-nums text-[var(--color-slate)]">{share}% · {r.negPct}% {t("busca.cNeg").toLowerCase()}</span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#090d15]">
                              <div className="h-full rounded-full" style={{ width: `${Math.max(share, 2)}%`, background: palette[i % palette.length] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10.5px] leading-snug text-[var(--color-slate)]">{t("busca.shareNote")}</p>
                  </div>
                  <div className="mt-3 overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="text-left text-[var(--color-slate)]"><tr><th className="py-1.5">{t("busca.cTerm")}</th><th>{t("busca.cVol")}</th><th>{t("busca.cNeg")}</th><th>{t("busca.cSample")}</th></tr></thead>
                  <tbody>
                    {cm.rows.map((r) => (
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
                </>
              );
            })()}
          </div>
        )}
      </AnimatedOverlay>
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
