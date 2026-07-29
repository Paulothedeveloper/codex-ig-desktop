import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n, LANGS } from "../i18n";
import SessionError from "../SessionError";
import MergePdf from "./MergePdf";
import { exportInteractionsPdf, exportUnifiedPdf } from "../pdf";
import type { UniPost, UniRow } from "../pdf";

type UniReport = { posts: UniPost[]; rows: UniRow[]; totLikes: number; totCmts: number };

// normaliza p/ busca: tira acento + minuscula (filtro forte, casa "tamara" com "Tâmara")
const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tauri não faz download de browser — salva via diálogo nativo + escrita no Rust.
async function saveBytes(bytes: Uint8Array, defaultName: string, filterName: string, ext: string) {
  const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return; // usuário cancelou
  await invoke("write_bytes", { path, bytes: Array.from(bytes) });
}

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type Post = { id: string; code: string; thumb: string; like: number; cmt: number; views: number; reshares: number; saves: number; taken_at: number; caption: string };
type Comment = { user: IgUser; text: string; likes: number; created_at: number };

function UserRow({ u }: { u: IgUser }) {
  return (
    <a
      href={`https://instagram.com/${u.username}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
    >
      <span className="truncate text-[13px] pii">@{u.username}</span>
      {u.full ? <span className="truncate text-[12px] text-[var(--color-slate)] pii">· {u.full}</span> : null}
      {u.verif ? <span className="text-[var(--color-teal)] text-[11px]">✓</span> : null}
    </a>
  );
}

function SortBtn({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={"rounded-md px-2.5 py-1 font-bold transition " + (on ? "bg-[var(--color-teal)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)] hover:text-[var(--color-paper)]")}
    >
      {label}
    </button>
  );
}


export default function Posts() {
  const { t, nf, lang } = useI18n();
  const loc = LANGS.find((l) => l.code === lang)!.locale;
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [feedNext, setFeedNext] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Post | null>(null);
  const [likers, setLikers] = useState<IgUser[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [dErr, setDErr] = useState("");
  const [view, setView] = useState<"likes" | "comments" | "reshares">("likes");
  const [reshares, setReshares] = useState<IgUser[] | null>(null);
  const [reLoading, setReLoading] = useState(false);
  const [sortL, setSortL] = useState<"recencia" | "alpha">("recencia");
  const [sortC, setSortC] = useState<"data" | "alpha">("data");
  const [filter, setFilter] = useState("");
  // multi-selecao p/ relatorio unificado
  const [picks, setPicks] = useState<Record<string, Post>>({});
  const [uni, setUni] = useState<{ on: boolean; done: number; total: number }>({ on: false, done: 0, total: 0 });
  // relatorio unificado montado (visto DENTRO do app; PDF vira botao)
  const [uniData, setUniData] = useState<UniReport | null>(null);
  const [uniSort, setUniSort] = useState<"inter" | "alpha">("inter");

  const f = norm(filter);
  const matchU = (u: IgUser) => !f || norm(u.username).includes(f) || norm(u.full).includes(f);

  const likersSorted = useMemo(() => {
    if (!likers) return [];
    const base = sortL === "alpha" ? [...likers].sort((a, b) => a.username.localeCompare(b.username)) : likers;
    return f ? base.filter(matchU) : base;
  }, [likers, sortL, f]);
  const commentsSorted = useMemo(() => {
    if (!comments) return [];
    const base = sortC === "alpha"
      ? [...comments].sort((a, b) => a.user.username.localeCompare(b.user.username))
      : [...comments].sort((a, b) => b.created_at - a.created_at);
    return f ? base.filter((c) => matchU(c.user) || norm(c.text).includes(f)) : base;
  }, [comments, sortC, f]);

  const pickIds = Object.keys(picks);

  // linhas do relatório unificado na ordem escolhida (alfabético por nome, ou por interação)
  const uniRowsView = useMemo(() => {
    if (!uniData) return [] as UniRow[];
    if (uniSort === "alpha")
      return [...uniData.rows].sort((a, b) => (a.full || a.username).toLowerCase().localeCompare((b.full || b.username).toLowerCase(), loc));
    return uniData.rows;
  }, [uniData, uniSort, loc]);

  async function loadPosts() {
    setLoading(true);
    setErr("");
    setSel(null);
    setPicks({});
    try {
      const page = await invoke<{ items: Post[]; next: string }>("ig_feed_page", { count: 24, maxId: "" });
      setPosts(page.items);
      setFeedNext(page.next);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!feedNext || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await invoke<{ items: Post[]; next: string }>("ig_feed_page", { count: 24, maxId: feedNext });
      setPosts((prev) => [...(prev || []), ...page.items]);
      setFeedNext(page.next);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function togglePick(p: Post) {
    setPicks((prev) => {
      const n = { ...prev };
      if (n[p.id]) delete n[p.id];
      else n[p.id] = p;
      return n;
    });
  }

  // relatorio UNIFICADO: puxa CURTIDAS + COMENTARIOS de cada post, junta por pessoa (dedup),
  // guarda quais posts curtiu + o TEXTO do comentario em qual post. Mostra DENTRO do app.
  async function buildUnified() {
    const chosen = pickIds.map((id) => picks[id]);
    if (chosen.length < 2) return;
    setUni({ on: true, done: 0, total: chosen.length });
    const posts: UniPost[] = chosen.map((p, i) => ({
      label: `#${i + 1}`,
      sub: `${dt(p.taken_at)} · ${(p.caption || t("posts.noCaption")).slice(0, 60)}`,
    }));
    const map = new Map<string, { u: IgUser; liked: number[]; commented: { post: number; text: string }[] }>();
    const ensure = (u: IgUser) => {
      let e = map.get(u.pk);
      if (!e) { e = { u, liked: [], commented: [] }; map.set(u.pk, e); }
      return e;
    };
    let totLikes = 0, totCmts = 0;
    try {
      for (let i = 0; i < chosen.length; i++) {
        const p = chosen[i];
        const [lk, cm] = await Promise.all([
          invoke<IgUser[]>("ig_likers", { mediaId: p.id }),
          invoke<Comment[]>("ig_comments", { mediaId: p.id }),
        ]);
        totLikes += lk.length;
        totCmts += cm.length;
        for (const u of lk) { const e = ensure(u); if (!e.liked.includes(i)) e.liked.push(i); }
        for (const c of cm) { const e = ensure(c.user); e.commented.push({ post: i, text: c.text }); }
        setUni({ on: true, done: i + 1, total: chosen.length });
      }
      const rows: UniRow[] = [...map.values()]
        .sort((a, b) => (b.liked.length + b.commented.length) - (a.liked.length + a.commented.length) || a.u.username.localeCompare(b.u.username))
        .map((e) => ({ username: e.u.username, full: e.u.full, verif: e.u.verif, liked: e.liked, commented: e.commented }));
      setUniData({ posts, rows, totLikes, totCmts });
    } catch (e) {
      setErr(String(e));
    } finally {
      setUni({ on: false, done: 0, total: 0 });
    }
  }

  // copia a lista simples (nome + @, na ordem atual, sem repetição)
  async function copyUnifiedSimple() {
    const txt = uniRowsView.map((r) => `${r.full || t("posts.noText")} — @${r.username}`).join("\n");
    await navigator.clipboard.writeText(txt);
  }

  // baixa o PDF do relatorio JA montado (na ordem escolhida)
  async function downloadUnifiedPdf() {
    if (!uniData) return;
    const bytes = exportUnifiedPdf({
      title: t("posts.uniTitle", { n: uniData.posts.length }),
      subtitle: t("posts.uniSub", { people: uniData.rows.length, likes: uniData.totLikes, cmts: uniData.totCmts, posts: uniData.posts.length }),
      posts: uniData.posts,
      rows: uniRowsView,
      legendLabel: t("posts.legend"),
      colUser: t("posts.colUser"),
      colName: t("posts.colName"),
      colLiked: t("posts.colLiked"),
      colCommented: t("posts.colCommented"),
      footer: t("posts.pdfFooter", { date: new Date().toLocaleString(loc) }),
    });
    setSaving(true);
    try { await saveBytes(bytes, `codexig-unificado-${uniData.posts.length}posts.pdf`, "PDF", "pdf"); } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  }

  async function openReshares(p: Post) {
    setReLoading(true);
    try { setReshares(await invoke<IgUser[]>("ig_reshares", { mediaId: p.id })); }
    catch { setReshares([]); }
    finally { setReLoading(false); }
  }

  async function open(p: Post) {
    setSel(p);
    setLikers(null);
    setComments(null);
    setReshares(null);
    setDErr("");
    setView("likes");
    setFilter("");
    setDLoading(true);
    try {
      // contagem AO VIVO (o feed traz numero cacheado; posts ganham interacao depois)
      invoke<{ like: number; cmt: number; reshares: number; saves: number }>("ig_media_info", { mediaId: p.id })
        .then((mc) => setSel((cur) => (cur && cur.id === p.id ? { ...cur, like: mc.like >= 0 ? mc.like : cur.like, cmt: mc.cmt >= 0 ? mc.cmt : cur.cmt, reshares: mc.reshares, saves: mc.saves } : cur)))
        .catch(() => {});
      const [lk, cm] = await Promise.all([
        invoke<IgUser[]>("ig_likers", { mediaId: p.id }),
        invoke<Comment[]>("ig_comments", { mediaId: p.id }),
      ]);
      setLikers(lk);
      setComments(cm);
    } catch (e) {
      setDErr(String(e));
    } finally {
      setDLoading(false);
    }
  }

  const dt = (ts: number) => (ts ? new Date(ts * 1000).toLocaleDateString(loc, { day: "2-digit", month: "short", year: "2-digit" }) : "");
  const dtt = (ts: number) => (ts ? new Date(ts * 1000).toLocaleString(loc, { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

  const [saving, setSaving] = useState(false);

  async function exportCsv() {
    if (!sel) return;
    const rows: string[] = ["tipo,usuario,nome,quando,texto"];
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    likersSorted.forEach((u) => rows.push(["curtiu", "@" + u.username, u.full, "", ""].map(esc).join(",")));
    commentsSorted.forEach((c) => rows.push(["comentou", "@" + c.user.username, c.user.full, dtt(c.created_at), c.text].map(esc).join(",")));
    const bytes = new TextEncoder().encode("﻿" + rows.join("\r\n")); // BOM + CRLF pro Excel
    setSaving(true);
    try { await saveBytes(bytes, `codexig-post-${sel.code}.csv`, "CSV", "csv"); } catch (e) { setDErr(String(e)); } finally { setSaving(false); }
  }

  async function exportPdf() {
    if (!sel) return;
    const bytes = exportInteractionsPdf({
      title: sel.caption || t("posts.noCaption"),
      subtitle: `${dt(sel.taken_at)}  ·  ${sel.like} ${t("posts.likes")}  ·  ${sel.cmt} ${t("posts.comments")}`,
      likersLabel: `${t("posts.whoLiked")} (${likersSorted.length})`,
      commentsLabel: `${t("posts.whoCommented")} (${commentsSorted.length})`,
      likers: likersSorted.map((u) => ({ username: u.username, full: u.full, verif: u.verif })),
      comments: commentsSorted.map((c) => ({ username: c.user.username, full: c.user.full, text: c.text, when: dtt(c.created_at), verif: c.user.verif })),
      colUser: t("posts.colUser"),
      colName: t("posts.colName"),
      colWhen: t("posts.colWhen"),
      colText: t("posts.colText"),
      footer: t("posts.pdfFooter", { date: new Date().toLocaleString(loc) }),
    });
    setSaving(true);
    try { await saveBytes(bytes, `codexig-post-${sel.code}.pdf`, "PDF", "pdf"); } catch (e) { setDErr(String(e)); } finally { setSaving(false); }
  }

  // ----- estado inicial -----
  if (!posts && !loading && !err) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
          <p className="mx-auto max-w-md text-sm text-[var(--color-slate)]">{t("posts.intro", { win: t("win.name") })}</p>
          <button
            onClick={loadPosts}
            className="mt-4 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99]"
          >
            {t("posts.load")}
          </button>
        </div>
      </div>
    );
  }
  if (loading)
    return (
      <div className="space-y-3">
        <div className="skel h-3 w-40" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skel aspect-square" />)}
        </div>
      </div>
    );
  if (err) return <SessionError err={err} onRetry={loadPosts} failedKey="posts.failed" />;

  return (
    <div className="space-y-6">
      {/* grid de posts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("posts.pick")}</span>
          <button onClick={loadPosts} className="text-[12px] font-bold text-[var(--color-teal)]">{t("posts.reload")}</button>
        </div>
        <div className="stagger grid grid-cols-3 gap-2 sm:grid-cols-4">
          {posts!.map((p) => {
            const on = sel?.id === p.id;
            const picked = !!picks[p.id];
            return (
              <div
                key={p.id}
                className={"group relative aspect-square overflow-hidden rounded-lg border transition hover:-translate-y-0.5 " + (on ? "border-[var(--color-teal)] ring-2 ring-[var(--color-teal)]/40" : picked ? "border-[var(--color-teal2)]" : "border-[var(--color-line)] hover:border-[var(--color-steel)]")}
              >
                <button onClick={() => open(p)} className="absolute inset-0 h-full w-full">
                  {p.thumb ? (
                    <img src={p.thumb} alt="" className="fade-img h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-[#0a0e15] text-[10px] text-[var(--color-slate)]">{t("posts.noCover")}</div>
                  )}
                </button>
                {/* checkbox de multi-selecao (relatorio unificado) */}
                <button
                  onClick={() => togglePick(p)}
                  title={t("posts.pickForUnified")}
                  className={"absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-md border text-[13px] font-bold transition " + (picked ? "border-[var(--color-teal)] bg-[var(--color-teal)] text-[#04120f]" : "border-white/50 bg-black/45 text-white hover:bg-black/70")}
                >
                  {picked ? "✓" : ""}
                </button>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10.5px] font-bold text-white">
                  <span>{nf(p.like)} {t("posts.likeShort")}</span>
                  <span>{nf(p.cmt)} {t("posts.cmtShort")}</span>
                </div>
              </div>
            );
          })}
        </div>
        {feedNext && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-3 w-full rounded-xl border border-[var(--color-steel)] bg-[#0e1522] py-2.5 text-[13px] font-bold text-[var(--color-paper)] hover:border-[var(--color-teal)] disabled:opacity-50"
          >
            {loadingMore ? t("posts.loadingMore") : t("posts.loadMore")}
          </button>
        )}
      </div>

      {/* barra do relatorio unificado (aparece com 2+ posts marcados) */}
      {pickIds.length >= 1 && (
        <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] px-4 py-3 shadow-lg">
          <span className="text-[13px] text-[var(--color-paper)]">{t("posts.picked", { n: pickIds.length })}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPicks({})} className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--color-slate)] hover:text-[var(--color-paper)]">{t("posts.clearPicks")}</button>
            <button
              onClick={buildUnified}
              disabled={pickIds.length < 2 || uni.on}
              className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2 text-[12.5px] font-bold text-[#04120f] disabled:opacity-40"
            >
              {uni.on ? t("posts.uniProgress", { done: uni.done, total: uni.total }) : t("posts.uniBtn")}
            </button>
          </div>
        </div>
      )}

      {/* detalhe do post selecionado */}
      {sel && (
        <div key={sel.id} className="pop rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold pii">{sel.caption || t("posts.noCaption")}</div>
              <div className="mt-0.5 text-[12px] text-[var(--color-slate)]">{dt(sel.taken_at)} · {nf(sel.like)} {t("posts.likes")} · {nf(sel.cmt)} {t("posts.comments")}{sel.reshares >= 0 ? ` · ${nf(sel.reshares)} ${t("posts.shares")}` : ""}{sel.saves >= 0 ? ` · ${nf(sel.saves)} ${t("posts.saves")}` : ""}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => open(sel)} disabled={dLoading} title={t("posts.reloadData")} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-2 text-[12px] font-bold text-[var(--color-teal2)] disabled:opacity-40">
                {dLoading ? t("posts.reloading") : t("posts.reloadData")}
              </button>
              <button onClick={exportPdf} disabled={dLoading || saving || (!likers && !comments)} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12px] font-bold text-[#04120f] disabled:opacity-40">
                {t("posts.exportPdf")}
              </button>
              <button onClick={exportCsv} disabled={dLoading || saving || (!likers && !comments)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)] disabled:opacity-40">
                {t("posts.export")}
              </button>
            </div>
          </div>

          {/* aviso honesto sobre compartilhar */}
          <p className="mt-3 rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-slate)]">
            {t("posts.shareNote")}
          </p>

          {dErr ? (
            <div className="mt-4"><SessionError err={dErr} onRetry={() => open(sel)} failedKey="posts.failed" /></div>
          ) : dLoading ? (
            <div className="mt-4 space-y-2">
              <div className="skel h-8 w-52" />
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="skel h-9" />)}
              <p className="pt-1 text-[12px] text-[var(--color-slate)]">{t("posts.pulling")}</p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <button onClick={() => setView("likes")} className={"rounded-lg px-3 py-1.5 text-[13px] font-bold " + (view === "likes" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)]")}>
                  {t("posts.whoLiked")} ({nf(likers?.length || 0)})
                </button>
                <button onClick={() => setView("comments")} className={"rounded-lg px-3 py-1.5 text-[13px] font-bold " + (view === "comments" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)]")}>
                  {t("posts.whoCommented")} ({nf(comments?.length || 0)})
                </button>
                <button
                  onClick={() => { setView("reshares"); if (reshares === null && !reLoading) openReshares(sel); }}
                  className={"rounded-lg px-3 py-1.5 text-[13px] font-bold " + (view === "reshares" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)]")}
                >
                  {t("posts.whoReshared")}{reshares ? ` (${nf(reshares.length)})` : ""}
                </button>
              </div>

              {view !== "reshares" && (
                <>
                  {/* filtro em tempo real (@ ou nome; comentário também casa texto) */}
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t("posts.filterPh")}
                    className="mb-2 w-full rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]"
                  />

                  {/* ordenação */}
                  <div className="mb-2 flex items-center gap-2 text-[11.5px]">
                    <span className="text-[var(--color-slate)]">{t("posts.sortBy")}:</span>
                    {view === "likes" ? (
                      <>
                        <SortBtn on={sortL === "recencia"} onClick={() => setSortL("recencia")} label={t("posts.sortRecent")} />
                        <SortBtn on={sortL === "alpha"} onClick={() => setSortL("alpha")} label={t("posts.sortAlpha")} />
                      </>
                    ) : (
                      <>
                        <SortBtn on={sortC === "data"} onClick={() => setSortC("data")} label={t("posts.sortDate")} />
                        <SortBtn on={sortC === "alpha"} onClick={() => setSortC("alpha")} label={t("posts.sortAlpha")} />
                      </>
                    )}
                    {f && <span className="text-[var(--color-teal2)]">{t("posts.filtering", { n: view === "likes" ? likersSorted.length : commentsSorted.length })}</span>}
                  </div>

                  {/* transparência: puxado vs contador do IG */}
                  {view === "likes" && likers && sel.like > likers.length && (
                    <p className="mb-2 rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[11px] leading-snug text-[var(--color-slate)]">
                      {t("posts.gapNote", { got: likers.length, count: sel.like })}
                    </p>
                  )}
                  {view === "comments" && comments && sel.cmt > comments.length && (
                    <p className="mb-2 rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[11px] leading-snug text-[var(--color-slate)]">
                      {t("posts.gapNoteC", { got: comments.length, count: sel.cmt })}
                    </p>
                  )}
                </>
              )}

              {/* aba recompartilhou: nota honesta sobre o limite do IG */}
              {view === "reshares" && (
                <p className="mb-2 rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[11px] leading-snug text-[var(--color-slate)]">
                  {t("posts.reshareNote")}
                </p>
              )}

              <div className="selectable stagger max-h-[42vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
                {view === "reshares" ? (
                  reLoading ? (
                    <div className="space-y-2 p-1">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-9" />)}</div>
                  ) : reshares && reshares.length > 0 ? (
                    reshares.map((u) => <UserRow key={u.pk} u={u} />)
                  ) : (
                    <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("posts.emptyReshares")}</p>
                  )
                ) : view === "likes" ? (
                  likersSorted.length > 0 ? (
                    likersSorted.map((u) => <UserRow key={u.pk} u={u} />)
                  ) : (
                    <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("posts.emptyLikes")}</p>
                  )
                ) : commentsSorted.length > 0 ? (
                  commentsSorted.map((c, i) => (
                    <div key={c.user.pk + i} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <a href={`https://instagram.com/${c.user.username}`} target="_blank" rel="noreferrer" className="shrink-0 text-[13px] font-semibold pii">@{c.user.username}</a>
                          {c.user.full ? <span className="truncate text-[12px] text-[var(--color-slate)] pii">· {c.user.full}</span> : null}
                          {c.user.verif ? <span className="shrink-0 text-[11px] text-[var(--color-teal)]">✓</span> : null}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-[var(--color-slate)] tabular-nums">{dtt(c.created_at)}</span>
                      </div>
                      <p className="text-[12.5px] leading-snug text-[var(--color-slate)] pii">{c.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("posts.emptyComments")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rota B: importar PDFs de fora e juntar em lista alfabética dedup */}
      <MergePdf />

      {/* relatorio unificado DENTRO do app (sem baixar; PDF vira botao) */}
      {uniData && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setUniData(null)}>
          <div className="pop flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
              <div>
                <div className="text-[15px] font-bold">{t("posts.uniTitle", { n: uniData.posts.length })}</div>
                <div className="text-[12px] text-[var(--color-slate)]">{t("posts.uniSub", { people: uniData.rows.length, likes: uniData.totLikes, cmts: uniData.totCmts, posts: uniData.posts.length })}</div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-[var(--color-line)] p-0.5">
                  <SortBtn on={uniSort === "inter"} onClick={() => setUniSort("inter")} label={t("posts.uniByInter")} />
                  <SortBtn on={uniSort === "alpha"} onClick={() => setUniSort("alpha")} label={t("posts.sortAlpha")} />
                </div>
                <button onClick={copyUnifiedSimple} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-2 text-[12px] font-bold text-[var(--color-paper)]">{t("posts.copyNames")}</button>
                <button onClick={downloadUnifiedPdf} disabled={saving} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12px] font-bold text-[#04120f] disabled:opacity-40">{t("posts.exportPdf")}</button>
                <button onClick={() => setUniData(null)} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)]">{t("posts.close")}</button>
              </div>
            </div>
            {/* legenda dos posts */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--color-line)] px-5 py-2 text-[11px] text-[var(--color-slate)]">
              {uniData.posts.map((p, i) => (
                <span key={i}><b className="text-[var(--color-teal2)]">{p.label}</b> <span className="pii">{p.sub}</span></span>
              ))}
            </div>
            {/* tabela */}
            <div className="selectable overflow-auto px-2 py-2">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-[var(--color-panel)]">
                  <tr className="text-left text-[var(--color-slate)]">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">{t("posts.colUser")}</th>
                    <th className="px-2 py-1.5">{t("posts.colName")}</th>
                    <th className="px-2 py-1.5">{t("posts.colLiked")}</th>
                    <th className="px-2 py-1.5">{t("posts.colCommented")}</th>
                  </tr>
                </thead>
                <tbody>
                  {uniRowsView.map((r, i) => (
                    <tr key={r.username + i} className="border-t border-[var(--color-line)] align-top hover:bg-white/5">
                      <td className="px-2 py-1.5 tabular-nums text-[var(--color-slate)]">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <a href={`https://instagram.com/${r.username}`} target="_blank" rel="noreferrer" className="font-semibold pii">@{r.username}</a>
                        {r.verif ? <span className="ml-1 text-[var(--color-teal)]">✓</span> : null}
                      </td>
                      <td className="px-2 py-1.5 pii">{r.full || "-"}</td>
                      <td className="px-2 py-1.5">
                        {r.liked.length ? r.liked.map((idx) => <span key={idx} className="mr-1 inline-block rounded bg-[#0e2a24] px-1.5 py-0.5 text-[10.5px] text-[var(--color-teal2)]">{uniData.posts[idx]?.label}</span>) : <span className="text-[var(--color-slate)]">-</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.commented.length ? (
                          <ul className="space-y-0.5">
                            {r.commented.map((c, k) => (
                              <li key={k}><b className="text-[var(--color-teal2)]">{uniData.posts[c.post]?.label}</b> <span className="pii text-[var(--color-slate)]">{c.text || t("posts.noText")}</span></li>
                            ))}
                          </ul>
                        ) : <span className="text-[var(--color-slate)]">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
