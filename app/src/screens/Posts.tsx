import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n, LANGS } from "../i18n";
import SessionError from "../SessionError";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type Post = { id: string; code: string; thumb: string; like: number; cmt: number; views: number; taken_at: number; caption: string };
type Comment = { user: IgUser; text: string; likes: number };

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

  function exportCsv() {
    if (!sel) return;
    const rows: string[] = ["tipo,usuario,nome,texto"];
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    (likers || []).forEach((u) => rows.push(["curtiu", "@" + u.username, u.full, ""].map(esc).join(",")));
    (comments || []).forEach((c) => rows.push(["comentou", "@" + c.user.username, c.user.full, c.text].map(esc).join(",")));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `codexig-post-${sel.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const dt = (ts: number) => (ts ? new Date(ts * 1000).toLocaleDateString(loc, { day: "2-digit", month: "short", year: "2-digit" }) : "");

  // ----- estado inicial -----
  if (!posts && !loading && !err) {
    return (
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
        <p className="mx-auto max-w-md text-sm text-[var(--color-slate)]">{t("posts.intro", { win: t("win.name") })}</p>
        <button
          onClick={loadPosts}
          className="mt-4 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99]"
        >
          {t("posts.load")}
        </button>
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
              <div className="mt-0.5 text-[12px] text-[var(--color-slate)]">{dt(sel.taken_at)} · {nf(sel.like)} {t("posts.likes")} · {nf(sel.cmt)} {t("posts.comments")}</div>
            </div>
            <button onClick={exportCsv} disabled={dLoading || (!likers && !comments)} className="shrink-0 rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12px] font-bold text-[var(--color-paper)] disabled:opacity-40">
              {t("posts.export")}
            </button>
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

              <div className="max-h-[46vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
                {view === "likes" ? (
                  likers && likers.length > 0 ? (
                    likers.map((u) => <UserRow key={u.pk} u={u} />)
                  ) : (
                    <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("posts.emptyLikes")}</p>
                  )
                ) : comments && comments.length > 0 ? (
                  comments.map((c, i) => (
                    <div key={c.user.pk + i} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
                      <a href={`https://instagram.com/${c.user.username}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold pii">@{c.user.username}</a>
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
    </div>
  );
}
