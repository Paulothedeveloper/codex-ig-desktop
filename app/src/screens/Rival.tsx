import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";
import Help from "../Help";
import Loading from "../Loading";

type RPost = { caption: string; likes: number; comments: number; views: number; isVideo: boolean };
type Prof = { name: string; user: string; bio: string; followers: number; posts: number; verif: boolean; list: RPost[] };

const nf = (n: number) => new Intl.NumberFormat().format(n || 0);
const handleOf = (raw: string) => {
  const m = raw.trim().match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return (m ? m[1] : raw).replace(/^@/, "").trim();
};

export default function Rival() {
  const { t } = useI18n();
  const groqKey = () => localStorage.getItem("codexig_groq") || "";
  const [objetivo, setObjetivo] = useState(() => localStorage.getItem("codexig_objetivo") || "");
  const [input, setInput] = useState("");
  const [prof, setProf] = useState<Prof | null>(null);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function analyze() {
    const h = handleOf(input);
    if (!h) return;
    const key = groqKey().trim();
    setBusy(t("rival.fetching")); setErr(""); setProf(null); setReport("");
    try {
      const j = await invoke<any>("ig_raw_get", { url: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}` });
      const u = j?.data?.user;
      if (!u) throw new Error(t("rival.notFound"));
      const edges = u?.edge_owner_to_timeline_media?.edges || [];
      const list: RPost[] = edges.map((e: any) => ({
        caption: e.node?.edge_media_to_caption?.edges?.[0]?.node?.text || "",
        likes: e.node?.edge_liked_by?.count ?? e.node?.edge_media_preview_like?.count ?? 0,
        comments: e.node?.edge_media_to_comment?.count ?? 0,
        views: e.node?.video_view_count ?? 0,
        isVideo: !!e.node?.is_video,
      }));
      const p: Prof = {
        name: u.full_name || h, user: h, bio: u.biography || "",
        followers: u.edge_followed_by?.count ?? 0, posts: u.edge_owner_to_timeline_media?.count ?? list.length,
        verif: !!u.is_verified, list,
      };
      setProf(p);
      if (!key) { setBusy(""); return; }
      setBusy(t("rival.analyzing"));
      const top = [...list].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 8);
      const persona = t("estudio.persona_" + (localStorage.getItem("codexig_usecase") || "geral"));
      const sys = `Voce e analista de inteligencia competitiva de redes sociais para ${persona}. Analise SO com base nos dados dados. Foque no OBJETIVO do usuario. PT-BR, direto e acionavel.`;
      const user =
        `MEU OBJETIVO: "${objetivo || t("rival.noGoal")}".\n\nCONCORRENTE @${p.user} (${nf(p.followers)} seguidores, ${nf(p.posts)} posts${p.verif ? ", verificado" : ""}). Bio: "${p.bio}".\nPosts recentes (engajamento | tipo | legenda):\n` +
        top.map((x, i) => `[${i}] ${nf(x.likes)} curt, ${nf(x.comments)} com${x.views ? `, ${nf(x.views)} views` : ""} | ${x.isVideo ? "video" : "foto"} | ${(x.caption || "").slice(0, 160)}`).join("\n") +
        `\n\nEntregue, focado no MEU objetivo:\n1) O QUE FUNCIONA pra ele (formato, ganchos, temas, frequencia aparente)\n2) PADRAO dos posts de maior engajamento\n3) LACUNAS / o que ele NAO faz (sua brecha)\n4) 5 ACOES concretas pra VOCE superar rumo ao seu objetivo\n5) 3 IDEIAS DE CONTEUDO inspiradas (sem copiar)`;
      const out = await invoke<string>("ai_chat", { system: sys, user, key, json: false });
      setReport(out);
    } catch (e) {
      const s = String(e);
      setErr(s.includes("BLOCK") || s.includes("require_login") ? "BLOCK" : s.includes(t("rival.notFound")) ? "NOTFOUND" : s);
    } finally { setBusy(""); }
  }

  const top = prof ? [...prof.list].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, 6) : [];

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-3 flex items-start gap-1.5">
          <p className="text-[13px] leading-snug text-[var(--color-slate)]">{t("rival.intro")}</p>
          <Help label={t("nav.rival.label")} text={t("help.rival")} />
        </div>
        <label className="block text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("rival.goal")}
          <input value={objetivo} onChange={(e) => { setObjetivo(e.target.value); localStorage.setItem("codexig_objetivo", e.target.value); }} placeholder={t("rival.goalPh")} className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
        </label>
        <div className="mt-3 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") analyze(); }} placeholder={t("rival.ph")} className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
          <button onClick={analyze} disabled={!!busy || !input.trim()} className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">{busy || t("rival.analyze")}</button>
        </div>
        {err && (
          <div className="mt-3 rounded-lg border border-[#43221d] bg-[#1a0e0c] px-3 py-2.5 text-[12.5px] text-[var(--color-coral2)]">
            {err === "BLOCK" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--color-paper)]">{t("rival.blocked")}</span>
                <button onClick={() => invoke("focus_ig").catch(() => {})} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-teal2)]">{t("rival.openIg")}</button>
              </div>
            ) : err === "NOTFOUND" ? (
              <span>{t("rival.notFound")} <span className="text-[var(--color-slate)]">{t("rival.errHint")}</span></span>
            ) : (
              <span>{err} <span className="text-[var(--color-slate)]">{t("rival.errHint")}</span></span>
            )}
          </div>
        )}
      </div>

      {busy && !prof && <Loading label={busy} steps={[t("rival.step1"), t("rival.step2"), t("rival.step3")]} skeleton={4} />}
      {busy && prof && !report && <Loading label={t("rival.analyzing")} steps={[t("rival.step2"), t("rival.step3")]} skeleton={3} />}
      {prof && (
        <div className="pop rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[15px] font-bold text-[var(--color-paper)]">{prof.name}</span>
            <span className="text-[12px] text-[var(--color-slate)] pii">@{prof.user}{prof.verif ? " ✓" : ""}</span>
          </div>
          {prof.bio && <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-slate)]">{prof.bio}</p>}
          <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
            <span className="text-[var(--color-slate)]">{t("rival.followers")}: <b className="text-[var(--color-teal2)] tabular-nums">{nf(prof.followers)}</b></span>
            <span className="text-[var(--color-slate)]">{t("rival.posts")}: <b className="text-[var(--color-paper)] tabular-nums">{nf(prof.posts)}</b></span>
          </div>
          {top.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("rival.topPosts")}</div>
              <div className="flex flex-col gap-1.5">
                {top.map((x, i) => (
                  <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[#0e1522] px-3 py-2">
                    <div className="flex items-center gap-3 text-[11.5px] tabular-nums text-[var(--color-slate)]">
                      <span className="text-[var(--color-teal2)] font-bold">{nf(x.likes)}</span> {t("rival.likes")}
                      <span className="text-[var(--color-paper)] font-bold">{nf(x.comments)}</span> {t("rival.comments")}
                      {x.views > 0 && <><span className="text-[var(--color-paper)] font-bold">{nf(x.views)}</span> views</>}
                      <span className="ml-auto rounded border border-[var(--color-steel)] px-1.5 text-[10px]">{x.isVideo ? "video" : "foto"}</span>
                    </div>
                    {x.caption && <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-ink)]">{x.caption.slice(0, 160)}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-[var(--color-teal2)]">{t("rival.reportTitle")}</span>
            <button onClick={() => navigator.clipboard.writeText(report)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-paper)]">{t("busca.copyReply")}</button>
          </div>
          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{report}</p>
        </div>
      )}
    </div>
  );
}
