import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import Help from "../Help";
import Loading from "../Loading";

type Media = { key: string; thumb: string; full: string; isVideo: boolean; mediaId: string; sc: string };
type Prof = { user: string; name: string; id: string; pic: string; photos: Media[]; videos: Media[]; stories: Media[] };
type Tab = "fotos" | "videos" | "stories";

const handleOf = (raw: string) => {
  const m = raw.trim().match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return (m ? m[1] : raw).replace(/^@/, "").trim();
};

// thumbnail via proxy Rust (CDN do IG bloqueia hotlink -> preview quebrava)
function Thumb({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let ok = true;
    if (url) invoke<string>("fetch_media_b64", { url }).then((d) => ok && setSrc(d)).catch(() => {});
    return () => { ok = false; };
  }, [url]);
  return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="skel h-full w-full" />;
}

export default function Baixar() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [prof, setProf] = useState<Prof | null>(null);
  const [tab, setTab] = useState<Tab>("fotos");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [dl, setDl] = useState("");
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  async function fetchProfile() {
    const h = handleOf(input);
    if (!h) return;
    setBusy(t("baixar.fetching")); setErr(""); setProf(null); setMsg(""); setBatch(null);
    try {
      const j = await invoke<any>("ig_raw_get", { url: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}` });
      const u = j?.data?.user;
      if (!u) throw new Error(t("baixar.notFound"));
      const edges = u?.edge_owner_to_timeline_media?.edges || [];
      const photos: Media[] = [], videos: Media[] = [];
      for (const e of edges) {
        const n = e.node || {};
        const m: Media = { key: n.id || n.shortcode, thumb: n.thumbnail_src || n.display_url || "", full: n.display_url || "", isVideo: !!n.is_video, mediaId: n.id || "", sc: n.shortcode || "" };
        if (n.is_video) videos.push({ ...m, full: n.video_url || "" }); else photos.push(m);
      }
      const id = u.id || "";
      let stories: Media[] = [];
      if (id) {
        try {
          const sj = await invoke<any>("ig_raw_get", { url: `/api/v1/feed/reels_media/?reel_ids=${id}` });
          const reel = sj?.reels_media?.[0] || sj?.reels?.[id];
          const items = reel?.items || [];
          stories = items.map((it: any, i: number) => {
            const vid = it.video_versions?.[0]?.url || "";
            const img = it.image_versions2?.candidates?.[0]?.url || "";
            return { key: it.id || "st" + i, thumb: img, full: vid || img, isVideo: !!vid, mediaId: it.id || "", sc: "" };
          });
        } catch { /* sem story ou fechado */ }
      }
      setProf({ user: h, name: u.full_name || h, id, pic: u.profile_pic_url_hd || u.profile_pic_url || "", photos, videos, stories });
      setTab(photos.length ? "fotos" : videos.length ? "videos" : "stories");
    } catch (e) {
      const s = String(e);
      setErr(s.includes("BLOCK") || s.includes("require_login") ? "BLOCK" : s.includes(t("baixar.notFound")) ? "NOTFOUND" : s);
    } finally { setBusy(""); }
  }

  // resolve a URL final de download de 1 item (vídeo pode precisar do media info)
  async function resolveUrl(m: Media): Promise<string> {
    if (m.full) return m.full;
    if (m.isVideo && m.mediaId) {
      try {
        const j = await invoke<any>("ig_raw_get", { url: `/api/v1/media/${m.mediaId}/info/` });
        return j?.items?.[0]?.video_versions?.[0]?.url || "";
      } catch { return ""; }
    }
    return "";
  }

  async function downloadOne(m: Media, i: number) {
    setErr(""); setMsg("");
    const url = await resolveUrl(m);
    if (!url) { setErr(t("baixar.noMedia")); return; }
    const ext = m.isVideo ? "mp4" : "jpg";
    const path = await save({ defaultPath: `${prof?.user}_${m.sc || m.mediaId || i}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    setDl(m.key);
    try { const n = await invoke<number>("download_url", { url, dest: path }); setMsg(t("baixar.saved", { kb: Math.round(n / 1024) })); }
    catch (e) { setErr(String(e)); } finally { setDl(""); }
  }

  async function downloadPic() {
    if (!prof?.pic) return;
    const path = await save({ defaultPath: `${prof.user}_perfil.jpg`, filters: [{ name: "JPG", extensions: ["jpg"] }] });
    if (!path) return;
    setDl("pic"); setErr(""); setMsg("");
    try { const n = await invoke<number>("download_url", { url: prof.pic, dest: path }); setMsg(t("baixar.saved", { kb: Math.round(n / 1024) })); }
    catch (e) { setErr(String(e)); } finally { setDl(""); }
  }

  // baixar TODOS do tab atual pra uma pasta escolhida, com barra de progresso
  async function downloadAll(list: Media[]) {
    if (!list.length) return;
    const dir = await open({ directory: true, title: t("baixar.pickFolder") });
    if (!dir || typeof dir !== "string") return;
    setErr(""); setMsg(""); setBatch({ done: 0, total: list.length });
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const url = await resolveUrl(m);
      if (url) {
        const ext = m.isVideo ? "mp4" : "jpg";
        const dest = `${dir}/${prof?.user}_${m.sc || m.mediaId || i}.${ext}`;
        try { await invoke<number>("download_url", { url, dest }); ok++; } catch { /* pula o que falhar */ }
      }
      setBatch({ done: i + 1, total: list.length });
    }
    setBatch(null);
    setMsg(t("baixar.batchDone", { ok, total: list.length }));
  }

  const list = prof ? (tab === "fotos" ? prof.photos : tab === "videos" ? prof.videos : prof.stories) : [];
  const pct = batch ? Math.round((batch.done / batch.total) * 100) : 0;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-3 flex items-start gap-1.5">
          <p className="text-[13px] leading-snug text-[var(--color-slate)]">{t("baixar.intro")}</p>
          <Help label={t("nav.baixar.label")} text={t("help.baixar")} />
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") fetchProfile(); }} placeholder={t("baixar.ph")} className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
          <button onClick={fetchProfile} disabled={!!busy || !input.trim()} className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">{busy || t("baixar.load")}</button>
        </div>
        {msg && <div className="mt-3 rounded-lg border border-[#1c3a2a] bg-[#0c1a12] px-3 py-2 text-[12.5px] text-[#3ad07a]">{msg}</div>}
        {err && (
          <div className="mt-3 rounded-lg border border-[#43221d] bg-[#1a0e0c] px-3 py-2.5 text-[12.5px] text-[var(--color-coral2)]">
            {err === "BLOCK" ? (
              <span className="flex flex-wrap items-center gap-2"><span className="text-[var(--color-paper)]">{t("rival.blocked")}</span><button onClick={() => invoke("focus_ig").catch(() => {})} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-teal2)]">{t("rival.openIg")}</button></span>
            ) : err === "NOTFOUND" ? (<span>{t("baixar.notFound")} <span className="text-[var(--color-slate)]">{t("rival.errHint")}</span></span>) : <span>{err}</span>}
          </div>
        )}
      </div>

      {busy && !prof && <Loading label={busy} steps={[t("baixar.step1"), t("baixar.step2")]} skeleton={3} />}

      {prof && (
        <>
          {/* foto de perfil */}
          <div className="pop flex items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full">{prof.pic ? <Thumb url={prof.pic} /> : <div className="h-full w-full bg-[#0e1522]" />}</div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-[var(--color-paper)]">{prof.name}</div>
              <div className="text-[12px] text-[var(--color-slate)] pii">@{prof.user}</div>
            </div>
            <button onClick={downloadPic} disabled={dl === "pic" || !prof.pic} className="ml-auto shrink-0 rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2 text-[12.5px] font-bold text-[var(--color-teal2)] disabled:opacity-50">{dl === "pic" ? t("baixar.saving") : t("baixar.dlPic")}</button>
          </div>

          {/* abas por tipo + baixar todos */}
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {([["fotos", prof.photos.length], ["videos", prof.videos.length], ["stories", prof.stories.length]] as const).map(([k, n]) => (
                <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-[13px] font-bold border ${tab === k ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)]"}`}>{t("baixar.tab_" + k)} <span className="tabular-nums opacity-70">{n}</span></button>
              ))}
              {list.length > 0 && !batch && <button onClick={() => downloadAll(list)} className="ml-auto rounded-xl bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-4 py-2 text-[13px] font-bold text-white">{t("baixar.dlAll")} ({list.length})</button>}
            </div>

            {batch && (
              <div className="mb-3 rounded-xl border border-[#7c3aed]/40 bg-[#0e1522] p-3">
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]"><span className="font-bold text-[#c4b5fd]">{t("baixar.downloading")} {batch.done}/{batch.total}</span><span className="tabular-nums text-[var(--color-slate)]">{pct}%</span></div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#090d15]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#7c3aed)] transition-all duration-300" style={{ width: `${pct}%` }} /></div>
              </div>
            )}

            {list.length === 0 ? (
              <p className="text-[13px] text-[var(--color-slate)]">{tab === "stories" ? t("baixar.noStory") : t("baixar.empty")}</p>
            ) : (
              <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {list.map((m, i) => (
                  <div key={m.key} className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0e1522]">
                    <div className="relative aspect-square"><Thumb url={m.thumb} />{m.isVideo && <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("baixar.video")}</span>}</div>
                    <button onClick={() => downloadOne(m, i)} disabled={dl === m.key} className="w-full border-t border-[var(--color-line)] px-2 py-1.5 text-[12px] font-bold text-[var(--color-teal2)] hover:bg-white/5 disabled:opacity-50">{dl === m.key ? t("baixar.saving") : t("baixar.dl")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
