import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ensureAccount, saveSnapshot, growthSeries, whoLeft } from "../db";
import { useI18n, LANGS } from "../i18n";

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
      <div className={"text-3xl font-bold tracking-tight " + (coral ? "text-[var(--color-coral2)]" : "text-[var(--color-teal)]")}>{v}</div>
      <div className="mt-1 text-[11px] text-[var(--color-slate)]">{label}</div>
    </div>
  );
}

export default function Relatorio() {
  const { t, nf, lang } = useI18n();
  const loc = LANGS.find((l) => l.code === lang)!.locale;
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
            {t("report.login", { win: t("win.name") })}
          </p>
          <button
            onClick={load}
            className="mt-4 rounded-xl px-5 py-2.5 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 active:scale-[.99]"
          >
            {t("report.load")}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-[var(--color-slate)] text-sm">
          {t("report.loading")}
        </div>
      )}

      {err && (
        <div className="rounded-2xl border border-[#43221d] bg-[#1a0f0d] p-4 text-[13px] text-[var(--color-coral2)]">
          {t("report.failed", { e: err })}
          <button onClick={load} className="ml-3 underline">{t("report.retry")}</button>
        </div>
      )}

      {graph && (
        <div className="space-y-6">
          {growth.length >= 2 ? (
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-2">{t("report.growthTitle")}</div>
              <Spark vals={growth.map((p) => p.followers)} />
              <div className="flex justify-between text-[12px] text-[var(--color-slate)] mt-2">
                <span>{new Date(growth[0].ts).toLocaleDateString(loc, { day: "2-digit", month: "short" })}</span>
                <span className="font-bold" style={{ color: growth[growth.length - 1].followers - growth[0].followers >= 0 ? "#00e5c9" : "#ff8a5c" }}>
                  {t("report.period", { n: (growth[growth.length - 1].followers - growth[0].followers >= 0 ? "+" : "") + nf(growth[growth.length - 1].followers - growth[0].followers) })}
                </span>
                <span>{t("report.today")}</span>
              </div>
              {diff && diff.prevTs && (diff.lost || diff.gained) ? (
                <div className="flex gap-2 mt-3 text-[11px]">
                  <span className="rounded-full border border-[#43221d] text-[var(--color-coral2)] px-3 py-1">{t("report.left")} <b className="text-[var(--color-coral)]">{diff.lost}</b></span>
                  <span className="rounded-full border border-[var(--color-steel)] text-[var(--color-slate)] px-3 py-1">{t("report.new")} <b className="text-[var(--color-teal)]">{diff.gained}</b></span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-slate)]">{t("report.growthHint")}</div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat v={nf(graph.following_count)} label={t("report.following")} />
            <Stat v={nf(graph.followers_count)} label={t("report.followers")} />
            <Stat v={nf(graph.non_followers.length)} label={t("report.nonFollowers")} coral />
            <Stat v={nf(mutuals)} label={t("report.mutuals")} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat v={nf(fans)} label={t("report.fans")} />
            <Stat v={ratio} label={t("report.ratio")} />
            {posts && posts.length > 0 && <Stat v={nf(avgLike)} label={t("report.avgLikes")} />}
            {posts && posts.length > 0 && <Stat v={eng.toFixed(1).replace(".", ",") + "%"} label={t("report.engagement")} />}
          </div>

          {posts && posts.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-2">
                {t("report.topPosts", { n, a: nf(avgLike), c: nf(avgCmt) })}{bestHour ? t("report.bestHour", { h: bestHour }) : ""}
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
                    <span className="w-5 text-[12px] font-bold text-[var(--color-slate)]">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate text-[13px]">{p.caption || t("report.noCaption")}</span>
                    <span className="text-[12px] font-bold text-[var(--color-coral2)]">{nf(p.like)}</span>
                    <span className="text-[11px] text-[var(--color-slate)]">{nf(p.cmt)} c</span>
                    {p.views > 0 && <span className="text-[11px] text-[var(--color-slate)]">{nf(p.views)} v</span>}
                  </a>
                ))}
              </div>
            </div>
          )}

          <button onClick={load} className="text-[13px] text-[var(--color-teal)] font-bold">{t("report.refresh")}</button>
        </div>
      )}
    </div>
  );
}
