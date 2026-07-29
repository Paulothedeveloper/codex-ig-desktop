import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n, LANGS } from "../i18n";
import SessionError from "../SessionError";
import { exportInteractionsPdf } from "../pdf";

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

function CapturePanel({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const [on, setOn] = useState(false);
  const [list, setList] = useState<{ url: string; method: string; hot: boolean }[]>([]);
  const [out, setOut] = useState("");
  async function start() {
    try { await invoke("ig_capture_start"); setOn(true); setOut(""); } catch (e) { setOut(String(e)); }
  }
  async function show() { setList(await invoke<{ url: string; method: string; hot: boolean }[]>("ig_capture_get")); }
  async function clear() { await invoke("ig_capture_clear"); setList([]); }
  async function tryit(u: string) {
    setOut(t("capture.testing"));
    try { setOut(JSON.stringify(await invoke("ig_raw_get", { url: u }), null, 1).slice(0, 6000)); }
    catch (e) { setOut(String(e)); }
  }
  return (
    <details className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
      <summary className="cursor-pointer text-[13px] font-bold text-[var(--color-teal2)]">{t("capture.title")}</summary>
      <p className="mt-2 text-[12px] leading-snug text-[var(--color-slate)]">{t("capture.hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={start} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12.5px] font-bold text-[#04120f]">{on ? t("capture.on") : t("capture.start")}</button>
        <button onClick={show} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)]">{t("capture.show")}</button>
        <button onClick={clear} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] text-[var(--color-slate)]">{t("capture.clear")}</button>
      </div>
      <div className="mt-3 max-h-[34vh] space-y-1 overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-2 font-mono text-[11px]">
        {list.length === 0 ? (
          <p className="text-[var(--color-slate)]">{t("capture.none")}</p>
        ) : (
          list.map((e, i) => (
            <div key={i} className={"flex items-center justify-between gap-2 rounded px-1.5 py-1 " + (e.hot ? "bg-[#0e2a24] text-[var(--color-teal2)]" : "text-[var(--color-slate)]")}>
              <span className="truncate">{e.hot ? "★ " : ""}{e.method} {e.url.replace("https://www.instagram.com", "")}</span>
              <button onClick={() => tryit(e.url)} className="shrink-0 rounded border border-[var(--color-steel)] px-2 py-0.5 text-[10.5px] text-[var(--color-paper)]">{t("capture.test")}</button>
            </div>
          ))
        )}
      </div>
      {out && <pre className="mt-2 max-h-[30vh] overflow-auto rounded-lg border border-[var(--color-line)] bg-[#05080d] p-2 text-[10.5px] text-[var(--color-ink)] whitespace-pre-wrap break-all">{out}</pre>}
    </details>
  );
}

export default function Posts() {
  const { t, nf, lang } = useI18n();
  const loc = LANGS.find((l) => l.code === lang)!.locale;
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Post | null>(null);
  const [likers, setLikers] = useState<IgUser[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [dErr, setDErr] = useState("");
  const [view, setView] = useState<"likes" | "comments">("likes");
  const [sortL, setSortL] = useState<"recencia" | "alpha">("recencia");
  const [sortC, setSortC] = useState<"data" | "alpha">("data");

  const likersSorted = useMemo(() => {
    if (!likers) return [];
    return sortL === "alpha" ? [...likers].sort((a, b) => a.username.localeCompare(b.username)) : likers;
  }, [likers, sortL]);
  const commentsSorted = useMemo(() => {
    if (!comments) return [];
    return sortC === "alpha"
      ? [...comments].sort((a, b) => a.user.username.localeCompare(b.user.username))
      : [...comments].sort((a, b) => b.created_at - a.created_at);
  }, [comments, sortC]);

  async function loadPosts() {
    setLoading(true);
    setErr("");
    setSel(null);
    try {
      setPosts(await invoke<Post[]>("ig_feed", { count: 24 }));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function open(p: Post) {
    setSel(p);
    setLikers(null);
    setComments(null);
    setDErr("");
    setView("likes");
    setDLoading(true);
    try {
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
        <CapturePanel t={t} />
      </div>
    );
  }
  if (loading) return <div className="text-sm text-[var(--color-slate)]">{t("posts.loading")}</div>;
  if (err) return <SessionError err={err} onRetry={loadPosts} failedKey="posts.failed" />;

  return (
    <div className="space-y-6">
      {/* grid de posts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("posts.pick")}</span>
          <button onClick={loadPosts} className="text-[12px] font-bold text-[var(--color-teal)]">{t("posts.reload")}</button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {posts!.map((p) => {
            const on = sel?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => open(p)}
                className={"group relative aspect-square overflow-hidden rounded-lg border transition " + (on ? "border-[var(--color-teal)] ring-2 ring-[var(--color-teal)]/40" : "border-[var(--color-line)] hover:border-[var(--color-steel)]")}
              >
                {p.thumb ? (
                  <img src={p.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[#0a0e15] text-[10px] text-[var(--color-slate)]">sem capa</div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10.5px] font-bold text-white">
                  <span>{nf(p.like)} ♥</span>
                  <span>{nf(p.cmt)} 💬</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* detalhe do post selecionado */}
      {sel && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold pii">{sel.caption || t("posts.noCaption")}</div>
              <div className="mt-0.5 text-[12px] text-[var(--color-slate)]">{dt(sel.taken_at)} · {nf(sel.like)} {t("posts.likes")} · {nf(sel.cmt)} {t("posts.comments")}{sel.reshares >= 0 ? ` · ${nf(sel.reshares)} ${t("posts.shares")}` : ""}{sel.saves >= 0 ? ` · ${nf(sel.saves)} ${t("posts.saves")}` : ""}</div>
            </div>
            <div className="flex shrink-0 gap-2">
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
            <div className="mt-4 text-sm text-[var(--color-slate)]">{t("posts.pulling")}</div>
          ) : (
            <div className="mt-4">
              <div className="mb-2 flex gap-2">
                <button onClick={() => setView("likes")} className={"rounded-lg px-3 py-1.5 text-[13px] font-bold " + (view === "likes" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)]")}>
                  {t("posts.whoLiked")} ({nf(likers?.length || 0)})
                </button>
                <button onClick={() => setView("comments")} className={"rounded-lg px-3 py-1.5 text-[13px] font-bold " + (view === "comments" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]" : "bg-[#0e1522] text-[var(--color-slate)]")}>
                  {t("posts.whoCommented")} ({nf(comments?.length || 0)})
                </button>
              </div>

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
              </div>

              <div className="max-h-[42vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
                {view === "likes" ? (
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

      <CapturePanel t={t} />
    </div>
  );
}
