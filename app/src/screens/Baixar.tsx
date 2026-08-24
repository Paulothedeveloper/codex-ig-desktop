import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import Help from "../Help";
import Loading from "../Loading";

type Item = { id: string; shortcode: string; thumb: string; image: string; isVideo: boolean; videoUrl: string; caption: string };
type Prof = { user: string; name: string; pic: string; items: Item[] };

const handleOf = (raw: string) => {
  const m = raw.trim().match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return (m ? m[1] : raw).replace(/^@/, "").trim();
};

export default function Baixar() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [prof, setProf] = useState<Prof | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [dl, setDl] = useState<string>(""); // id sendo baixado

  async function fetchProfile() {
    const h = handleOf(input);
    if (!h) return;
    setBusy(t("baixar.fetching")); setErr(""); setProf(null); setMsg("");
    try {
      const j = await invoke<any>("ig_raw_get", { url: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}` });
      const u = j?.data?.user;
      if (!u) throw new Error(t("baixar.notFound"));
      const edges = u?.edge_owner_to_timeline_media?.edges || [];
      const items: Item[] = edges.map((e: any) => ({
        id: e.node?.id || "", shortcode: e.node?.shortcode || "",
        thumb: e.node?.thumbnail_src || e.node?.display_url || "",
        image: e.node?.display_url || "",
        isVideo: !!e.node?.is_video, videoUrl: e.node?.video_url || "",
        caption: e.node?.edge_media_to_caption?.edges?.[0]?.node?.text || "",
      }));
      setProf({ user: h, name: u.full_name || h, pic: u.profile_pic_url_hd || u.profile_pic_url || "", items });
    } catch (e) {
      const s = String(e);
      setErr(s.includes("BLOCK") || s.includes("require_login") ? "BLOCK" : s.includes(t("baixar.notFound")) ? "NOTFOUND" : s);
    } finally { setBusy(""); }
  }

  async function download(url: string, suggested: string, id = "") {
    if (!url) { setErr(t("baixar.noMedia")); return; }
    setErr(""); setMsg("");
    const ext = url.includes(".mp4") ? "mp4" : "jpg";
    const path = await save({ defaultPath: suggested + "." + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    setDl(id || "pic");
    try {
      const n = await invoke<number>("download_url", { url, dest: path });
      setMsg(t("baixar.saved", { kb: Math.round(n / 1024) }));
    } catch (e) { setErr(String(e)); } finally { setDl(""); }
  }

  // video: usa video_url do perfil; se faltar, busca o media info
  async function downloadPost(it: Item) {
    let url = it.image;
    if (it.isVideo) {
      url = it.videoUrl;
      if (!url && it.id) {
        try {
          const j = await invoke<any>("ig_raw_get", { url: `/api/v1/media/${it.id}/info/` });
          url = j?.items?.[0]?.video_versions?.[0]?.url || "";
        } catch { /* cai no erro abaixo */ }
      }
    }
    await download(url, `${prof?.user}_${it.shortcode || it.id}`, it.id);
  }

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
            ) : err === "NOTFOUND" ? (
              <span>{t("baixar.notFound")} <span className="text-[var(--color-slate)]">{t("rival.errHint")}</span></span>
            ) : <span>{err}</span>}
          </div>
        )}
      </div>

      {busy && !prof && <Loading label={busy} steps={[t("baixar.step1"), t("baixar.step2")]} skeleton={3} />}

      {prof && (
        <div className="pop rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
          <div className="flex items-center gap-3">
            {prof.pic && <img src={prof.pic} alt="" className="h-16 w-16 rounded-full object-cover" />}
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-[var(--color-paper)]">{prof.name}</div>
              <div className="text-[12px] text-[var(--color-slate)] pii">@{prof.user}</div>
            </div>
            <button onClick={() => download(prof.pic, prof.user + "_perfil", "pic")} disabled={dl === "pic" || !prof.pic} className="ml-auto rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2 text-[12.5px] font-bold text-[var(--color-teal2)] disabled:opacity-50">{dl === "pic" ? t("baixar.saving") : t("baixar.dlPic")}</button>
          </div>

          {prof.items.length > 0 && (
            <>
              <div className="mb-2 mt-4 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("baixar.recent")}</div>
              <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {prof.items.map((it) => (
                  <div key={it.id} className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[#0e1522]">
                    <div className="relative aspect-square">
                      {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-[#090d15]" />}
                      {it.isVideo && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">vídeo</span>}
                    </div>
                    <button onClick={() => downloadPost(it)} disabled={dl === it.id} className="w-full border-t border-[var(--color-line)] px-2 py-1.5 text-[12px] font-bold text-[var(--color-teal2)] hover:bg-white/5 disabled:opacity-50">{dl === it.id ? t("baixar.saving") : t("baixar.dl")}</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
