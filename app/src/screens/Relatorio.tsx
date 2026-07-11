import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ensureAccount, saveSnapshot, growthSeries, whoLeft } from "../db";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type Graph = {
  following_count: number;
  followers_count: number;
  non_followers: IgUser[];
  followers?: IgUser[];
};

function Spark({ vals }: { vals: number[] }) {
  if (vals.length < 2) return null;
  const w = 520, h = 60;
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - min) / rng) * (h - 8)).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#00e5c9" stopOpacity="0.28" /><stop offset="1" stopColor="#00e5c9" stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sg)" />
      <polyline points={pts} fill="none" stroke="#00e5c9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
type Post = { code: string; like: number; cmt: number; views: number; taken_at: number; caption: string };

function Stat({ v, label, coral }: { v: string | number; label: string; coral?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
      <div className={"text-3xl font-extrabold tracking-tight " + (coral ? "text-[var(--color-coral2)]" : "text-[var(--color-teal)]")}>{v}</div>
      <div className="mt-1 text-[11px] text-[var(--color-slate)]">{label}</div>
    </div>
  );
}

const nf = new Intl.NumberFormat("pt-BR");

export default function Relatorio() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [growth, setGrowth] = useState<{ ts: number; followers: number }[]>([]);
  const [diff, setDiff] = useState<{ lost: number; gained: number; prevTs: number | null } | null>(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const g = await invoke<Graph>("ig_graph");
      setGraph(g);
      // snapshot + crescimento no tempo (SQLite) — bônus, não quebra o relatório
      try {
        const uid = await invoke<string>("ig_session_ok");
        const accId = await ensureAccount(uid);
        await saveSnapshot(accId, g.following_count, g.followers_count, (g.followers || []).map((u) => u.pk));
        setGrowth(await growthSeries(accId));
        setDiff(await whoLeft(accId));
      } catch { /* ignora */ }
      try {
        setPosts(await invoke<Post[]>("ig_feed", { count: 12 }));
      } catch {
        setPosts([]);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const mutuals = graph ? graph.following_count - graph.non_followers.length : 0;
  const fans = graph ? graph.followers_count - mutuals : 0;
  const ratio = graph && graph.followers_count ? (graph.following_count / graph.followers_count).toFixed(2) : "—";

  const n = posts?.length || 0;
  const avgLike = n ? Math.round(posts!.reduce((a, p) => a + p.like, 0) / n) : 0;
  const avgCmt = n ? Math.round(posts!.reduce((a, p) => a + p.cmt, 0) / n) : 0;
  const eng = graph && graph.followers_count ? ((avgLike + avgCmt) / graph.followers_count) * 100 : 0;
  const top = posts ? [...posts].sort((a, b) => b.like + b.cmt - (a.like + a.cmt)) : [];
  const bestHour = (() => {
    if (!top.length) return null;
    const hrs: Record<number, number> = {};
    top.slice(0, 5).forEach((p) => { if (p.taken_at) { const h = new Date(p.taken_at * 1000).getHours(); hrs[h] = (hrs[h] || 0) + 1; } });
    const e = Object.entries(hrs).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : null;
  })();

  return (
    <div>
      {!graph && !loading && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
          <p className="text-[var(--color-slate)] text-sm max-w-md mx-auto">
            Faça login na janela <b className="text-[var(--color-paper)]">Codex IG — Instagram</b>, depois carregue.
            Lê tua sessão local (só leitura), sem servidor.
          </p>
          <button
            onClick={load}
            className="mt-4 rounded-xl px-5 py-2.5 font-extrabold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 active:scale-[.99]"
          >
            Carregar relatório
          </button>
        </div>
      )}

      {loading && (
        <div className="text-[var(--color-slate)] text-sm">
          Lendo tua sessão (seguindo + seguidores + posts)… pode levar alguns segundos.
        </div>
      )}

      {err && (
        <div className="rounded-2xl border border-[#43221d] bg-[#1a0f0d] p-4 text-[13px] text-[var(--color-coral2)]">
          Falhou: {err}
          <button onClick={load} className="ml-3 underline">tentar de novo</button>
        </div>
      )}

      {graph && (
        <div className="space-y-6">
          {growth.length >= 2 ? (
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-2">Crescimento de seguidores</div>
              <Spark vals={growth.map((p) => p.followers)} />
              <div className="flex justify-between text-[12px] text-[var(--color-slate)] mt-2">
                <span>{new Date(growth[0].ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>
                <span className="font-bold" style={{ color: growth[growth.length - 1].followers - growth[0].followers >= 0 ? "#00e5c9" : "#ff8a5c" }}>
                  {growth[growth.length - 1].followers - growth[0].followers >= 0 ? "+" : ""}
                  {nf.format(growth[growth.length - 1].followers - growth[0].followers)} no período
                </span>
                <span>hoje</span>
              </div>
              {diff && diff.prevTs && (diff.lost || diff.gained) ? (
                <div className="flex gap-2 mt-3 text-[11px]">
                  <span className="rounded-full border border-[#43221d] text-[var(--color-coral2)] px-3 py-1">deixaram: <b className="text-[var(--color-coral)]">{diff.lost}</b></span>
                  <span className="rounded-full border border-[var(--color-steel)] text-[var(--color-slate)] px-3 py-1">novos: <b className="text-[var(--color-teal)]">{diff.gained}</b></span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-slate)]">Crescimento no tempo: guardo 1 ponto/dia (SQLite local). Volte amanhã pra ver a curva.</div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat v={nf.format(graph.following_count)} label="seguindo" />
            <Stat v={nf.format(graph.followers_count)} label="seguidores" />
            <Stat v={nf.format(graph.non_followers.length)} label="não te seguem de volta" coral />
            <Stat v={nf.format(mutuals)} label="mútuos (troca real)" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat v={nf.format(fans)} label="fãs (te seguem, você não)" />
            <Stat v={ratio} label="razão seg./seguidores" />
            {posts && posts.length > 0 && <Stat v={nf.format(avgLike)} label="média de curtidas" />}
            {posts && posts.length > 0 && <Stat v={eng.toFixed(1).replace(".", ",") + "%"} label="engajamento/post" />}
          </div>

          {posts && posts.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-2">
                Top posts (últimos {n}) · média {nf.format(avgLike)} curtidas · {nf.format(avgCmt)} coment.{bestHour ? ` · melhor horário ~${bestHour}h` : ""}
              </div>
              <div className="rounded-2xl border border-[var(--color-line)] bg-[#090d15] p-2">
                {top.map((p, i) => (
                  <a
                    key={p.code}
                    href={`https://instagram.com/p/${p.code}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5"
                  >
                    <span className="w-5 text-[12px] font-bold text-[#4a5a6d]">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate text-[13px]">{p.caption || "(sem legenda)"}</span>
                    <span className="text-[12px] font-bold text-[var(--color-coral2)]">{nf.format(p.like)}</span>
                    <span className="text-[11px] text-[var(--color-slate)]">{nf.format(p.cmt)} c</span>
                    {p.views > 0 && <span className="text-[11px] text-[var(--color-slate)]">{nf.format(p.views)} v</span>}
                  </a>
                ))}
              </div>
            </div>
          )}

          <button onClick={load} className="text-[13px] text-[var(--color-teal)] font-bold">Atualizar</button>
        </div>
      )}
    </div>
  );
}
