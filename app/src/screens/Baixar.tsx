import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import Help from "../Help";
import Loading from "../Loading";

type Media = { key: string; thumb: string; full: string; isVideo: boolean; mediaId: string; sc: string };
type Mode = "perfil" | "post" | "story";
type Tab = "fotos" | "videos";

const A64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// shortcode do post/reel -> media_id (base64 BigInt), pra buscar /media/{id}/info
function scToId(sc: string): string {
  let n = 0n;
  for (const c of sc) { const i = A64.indexOf(c); if (i < 0) return ""; n = n * 64n + BigInt(i); }
  return n.toString();
}
const handleOf = (raw: string) => (raw.trim().match(/instagram\.com\/([A-Za-z0-9._]+)/)?.[1] || raw).replace(/^@/, "").trim();
const scOf = (raw: string) => raw.trim().match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] || "";

// thumbnail via proxy Rust (CDN do IG bloqueia hotlink -> preview quebrava)
function Thumb({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let ok = true; if (url) invoke<string>("fetch_media_b64", { url }).then((d) => ok && setSrc(d)).catch(() => {}); return () => { ok = false; }; }, [url]);
  return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="skel h-full w-full" />;
}

// extrai as midias de um item de media info (single, video ou carrossel)
function itemsFromMedia(it: any): Media[] {
  const one = (x: any, i: number): Media => {
    const vid = x?.video_versions?.[0]?.url || "";
    const img = x?.image_versions2?.candidates?.[0]?.url || "";
    return { key: (x?.id || "") + "_" + i, thumb: img, full: vid || img, isVideo: !!vid, mediaId: x?.id || "", sc: x?.code || "" };
  };
  if (it?.carousel_media?.length) return it.carousel_media.map(one);
  return [one(it, 0)];
}

export default function Baixar() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("perfil");
  const [input, setInput] = useState("");
  const [pic, setPic] = useState("");
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [photos, setPhotos] = useState<Media[]>([]);
  const [videos, setVideos] = useState<Media[]>([]);
  const [postItems, setPostItems] = useState<Media[]>([]);
  const [stories, setStories] = useState<Media[]>([]);
  const [tab, setTab] = useState<Tab>("fotos");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [dl, setDl] = useState("");
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  function reset() { setPic(""); setName(""); setUser(""); setPhotos([]); setVideos([]); setPostItems([]); setStories([]); setLoaded(false); setErr(""); setMsg(""); setBatch(null); }

  async function load() {
    setErr(""); setMsg(""); setBatch(null);
    if (mode === "post") {
      const sc = scOf(input);
      if (!sc) { setErr(t("baixar.needLink")); return; }
      const id = scToId(sc);
      if (!id) { setErr(t("baixar.needLink")); return; }
      setBusy(t("baixar.fetching")); reset();
      try {
        const j = await invoke<any>("ig_raw_get", { url: `/api/v1/media/${id}/info/` });
        const it = j?.items?.[0];
        if (!it) throw new Error(t("baixar.notFound"));
        setPostItems(itemsFromMedia(it));
        const uu = it?.user?.username || ""; setUser(uu); setName(it?.user?.full_name || uu);
        setLoaded(true);
      } catch (e) { onErr(e); } finally { setBusy(""); }
      return;
    }
    // perfil / story: precisa do @
    const h = handleOf(input);
    if (!h) { setErr(t("baixar.needUser")); return; }
    setBusy(t("baixar.fetching")); reset();
    try {
      const j = await invoke<any>("ig_raw_get", { url: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}` });
      const u = j?.data?.user;
      if (!u) throw new Error(t("baixar.notFound"));
      setUser(h); setName(u.full_name || h); setPic(u.profile_pic_url_hd || u.profile_pic_url || "");
      if (mode === "story") {
        const id = u.id || "";
        let st: Media[] = [];
        if (id) {
          try {
            const sj = await invoke<any>("ig_raw_get", { url: `/api/v1/feed/reels_media/?reel_ids=${id}` });
            const reel = sj?.reels_media?.[0] || sj?.reels?.[id];
            st = (reel?.items || []).map((it: any, i: number) => { const v = it.video_versions?.[0]?.url || ""; const im = it.image_versions2?.candidates?.[0]?.url || ""; return { key: it.id || "st" + i, thumb: im, full: v || im, isVideo: !!v, mediaId: it.id || "", sc: "" }; });
          } catch { /* fechado/sem story */ }
        }
        setStories(st);
      } else {
        const edges = u?.edge_owner_to_timeline_media?.edges || [];
        const ph: Media[] = [], vd: Media[] = [];
        for (const e of edges) {
          const n = e.node || {};
          const m: Media = { key: n.id || n.shortcode, thumb: n.thumbnail_src || n.display_url || "", full: n.display_url || "", isVideo: !!n.is_video, mediaId: n.id || "", sc: n.shortcode || "" };
          if (n.is_video) vd.push({ ...m, full: n.video_url || "" }); else ph.push(m);
        }
        setPhotos(ph); setVideos(vd); setTab(ph.length ? "fotos" : "videos");
      }
      setLoaded(true);
    } catch (e) { onErr(e); } finally { setBusy(""); }
  }
  function onErr(e: unknown) {
    const s = String(e);
    if (s.includes("require_login")) setErr("LOGIN");
    else if (s.includes("ig_rate_limited") || s.includes("BLOCK")) setErr("RATE");
    else if (s.includes(t("baixar.notFound"))) setErr("NOTFOUND");
    else setErr(s); // erro REAL do IG (ex: "IG 404: Media not found") — mostra a verdade
  }

  async function resolveUrl(m: Media): Promise<string> {
    if (m.full) return m.full;
    if (m.isVideo && m.mediaId) { try { const j = await invoke<any>("ig_raw_get", { url: `/api/v1/media/${m.mediaId}/info/` }); return j?.items?.[0]?.video_versions?.[0]?.url || ""; } catch { return ""; } }
    return "";
  }
  async function downloadUrl(url: string, suggested: string, ext: string, key: string) {
    const path = await save({ defaultPath: suggested + "." + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    setDl(key); setErr(""); setMsg("");
    try { const n = await invoke<number>("download_url", { url, dest: path }); setMsg(t("baixar.saved", { kb: Math.round(n / 1024) })); }
    catch (e) { setErr(String(e)); } finally { setDl(""); }
  }
  async function downloadOne(m: Media, i: number) {
    const url = await resolveUrl(m);
    if (!url) { setErr(t("baixar.noMedia")); return; }
    await downloadUrl(url, `${user || "ig"}_${m.sc || m.mediaId || i}`, m.isVideo ? "mp4" : "jpg", m.key);
  }
  async function downloadAll(list: Media[]) {
    if (!list.length) return;
    const dir = await open({ directory: true, title: t("baixar.pickFolder") });
    if (!dir || typeof dir !== "string") return;
    setErr(""); setMsg(""); setBatch({ done: 0, total: list.length });
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const url = await resolveUrl(list[i]);
      if (url) { const ext = list[i].isVideo ? "mp4" : "jpg"; try { await invoke("download_url", { url, dest: `${dir}/${user || "ig"}_${list[i].sc || list[i].mediaId || i}.${ext}` }); ok++; } catch { /* pula */ } }
      setBatch({ done: i + 1, total: list.length });
    }
    setBatch(null); setMsg(t("baixar.batchDone", { ok, total: list.length }));
  }

  const list = mode === "post" ? postItems : mode === "story" ? stories : tab === "fotos" ? photos : videos;
  const pct = batch ? Math.round((batch.done / batch.total) * 100) : 0;
  const ph = mode === "post" ? t("baixar.phLink") : t("baixar.phUser");

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-3 flex items-start gap-1.5">
          <p className="text-[13px] leading-snug text-[var(--color-slate)]">{t("baixar.intro")}</p>
          <Help label={t("nav.baixar.label")} text={t("help.baixar")} />
        </div>
        {/* SELETOR: o que baixar */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("baixar.what")}</span>
          {(["perfil", "post", "story"] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); reset(); }} className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold ${mode === m ? "border-[var(--color-teal)] bg-[var(--color-teal)]/15 text-[var(--color-teal2)]" : "border-[var(--color-steel)] bg-[#0e1522] text-[var(--color-slate)]"}`}>{t("baixar.mode_" + m)}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} placeholder={ph} className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
          <button onClick={load} disabled={!!busy || !input.trim()} className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">{busy || t("baixar.load")}</button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-slate)]">{t("baixar.hint_" + mode)}</p>
        {msg && <div className="mt-3 rounded-lg border border-[#1c3a2a] bg-[#0c1a12] px-3 py-2 text-[12.5px] text-[#3ad07a]">{msg}</div>}
        {err && (
          <div className="mt-3 rounded-lg border border-[#43221d] bg-[#1a0e0c] px-3 py-2.5 text-[12.5px] text-[var(--color-coral2)]">
            {err === "RATE" || err === "LOGIN" ? (
              <span className="flex flex-wrap items-center gap-2"><span className="text-[var(--color-paper)]">{err === "LOGIN" ? t("baixar.login") : t("baixar.blocked")}</span><button onClick={() => invoke("focus_ig").catch(() => {})} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-teal2)]">{t("rival.openIg")}</button></span>
            ) : err === "NOTFOUND" ? (<span>{t("baixar.notFound")} <span className="text-[var(--color-slate)]">{mode === "post" ? t("baixar.notFoundPost") : t("rival.errHint")}</span></span>) : <span>{err}</span>}
          </div>
        )}
      </div>

      {busy && !loaded && <Loading label={busy} steps={[t("baixar.step1"), t("baixar.step2")]} skeleton={3} />}

      {/* FOTO DE PERFIL (modo perfil) */}
      {loaded && mode === "perfil" && (
        <div className="pop flex items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full">{pic ? <Thumb url={pic} /> : <div className="h-full w-full bg-[#0e1522]" />}</div>
          <div className="min-w-0"><div className="text-[15px] font-bold text-[var(--color-paper)]">{name}</div><div className="text-[12px] text-[var(--color-slate)] pii">@{user}</div></div>
          <button onClick={() => pic && downloadUrl(pic, user + "_perfil", "jpg", "pic")} disabled={dl === "pic" || !pic} className="ml-auto shrink-0 rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2 text-[12.5px] font-bold text-[var(--color-teal2)] disabled:opacity-50">{dl === "pic" ? t("baixar.saving") : t("baixar.dlPic")}</button>
        </div>
      )}

      {/* GRID de midias (perfil: fotos/videos · post · story) */}
      {loaded && (mode !== "perfil" || photos.length + videos.length > 0) && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {mode === "perfil" && ([["fotos", photos.length], ["videos", videos.length]] as const).map(([k, n]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-[13px] font-bold border ${tab === k ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)]"}`}>{t("baixar.tab_" + k)} <span className="tabular-nums opacity-70">{n}</span></button>
            ))}
            {mode !== "perfil" && <span className="text-[13px] font-bold text-[var(--color-paper)]">{t("baixar.mode_" + mode)} <span className="tabular-nums text-[var(--color-slate)]">{list.length}</span></span>}
            {list.length > 1 && !batch && <button onClick={() => downloadAll(list)} className="ml-auto rounded-xl bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-4 py-2 text-[13px] font-bold text-white">{t("baixar.dlAll")} ({list.length})</button>}
          </div>
          {batch && (
            <div className="mb-3 rounded-xl border border-[#7c3aed]/40 bg-[#0e1522] p-3">
              <div className="mb-1 flex items-baseline justify-between text-[12.5px]"><span className="font-bold text-[#c4b5fd]">{t("baixar.downloading")} {batch.done}/{batch.total}</span><span className="tabular-nums text-[var(--color-slate)]">{pct}%</span></div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#090d15]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#7c3aed)] transition-all duration-300" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          {list.length === 0 ? (
            <p className="text-[13px] text-[var(--color-slate)]">{mode === "story" ? t("baixar.noStory") : t("baixar.empty")}</p>
          ) : (
            <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {list.map((m, i) => (
                <div key={m.key} className="lift overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0e1522]">
                  <div className="relative aspect-square"><Thumb url={m.thumb} />{m.isVideo && <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("baixar.video")}</span>}</div>
                  <button onClick={() => downloadOne(m, i)} disabled={dl === m.key} className="w-full border-t border-[var(--color-line)] px-2 py-1.5 text-[12px] font-bold text-[var(--color-teal2)] hover:bg-white/5 disabled:opacity-50">{dl === m.key ? t("baixar.saving") : t("baixar.dl")}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
