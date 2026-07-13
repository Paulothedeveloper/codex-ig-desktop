import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Ic } from "../icons";
import { useI18n } from "../i18n";
import { Select } from "../Select";
import SessionError from "../SessionError";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
const SEGS = ["editor", "dev", "biz", "ref"] as const;

export default function Alvos() {
  const { t, nf } = useI18n();
  const [inp, setInp] = useState("");
  const [cap, setCap] = useState(300);
  const [seg, setSeg] = useState<string>(SEGS[0]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [found, setFound] = useState<IgUser[] | null>(null);

  async function search() {
    const competitors = inp.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
    if (!competitors.length) { setMsg(t("targets.needOne")); return; }
    setLoading(true); setMsg(""); setErr(""); setFound(null);
    try {
      const r = await invoke<IgUser[]>("ig_targets", { competitors, cap });
      setFound(r);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  function copyList() {
    if (!found) return;
    const txt = found.map((u, i) => `${i + 1}. @${u.username} — ${u.full || ""} https://instagram.com/${u.username}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => setMsg(t("targets.copied")));
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--color-slate)]">{t("targets.intro")}</p>

      <input value={inp} onChange={(e) => setInp(e.target.value)} placeholder={t("targets.placeholder")} className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-[var(--color-slate)] font-semibold">{t("targets.sample")}
          <input type="number" value={cap} min={50} max={2000} onChange={(e) => setCap(Math.max(50, +e.target.value))} className="mt-1 w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
        </label>
        <label className="text-[11px] text-[var(--color-slate)] font-semibold">{t("targets.segment")}
          <Select
            value={seg}
            onChange={setSeg}
            ariaLabel={t("targets.segment")}
            options={SEGS.map((k) => ({ value: k, label: t("seg." + k) }))}
          />
        </label>
      </div>

      <button onClick={search} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 disabled:opacity-50">
        <Ic n="instagram" s={17} />{loading ? t("targets.searching") : t("targets.search")}
      </button>

      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 text-[13px]">
        <span className="text-[var(--color-teal)] font-bold">{t("targets.model", { seg: t("seg." + seg) })}</span>
        <div className="text-[var(--color-ink)] mt-1">"{t("seg." + seg + ".model")}"</div>
        <div className="text-[var(--color-slate)] text-[12px] mt-1">{t("targets.modelHint")}</div>
      </div>

      {msg && <div className="text-[13px] text-[var(--color-slate)]">{msg}</div>}
      {err && <SessionError err={err} onRetry={search} failedKey="targets.failed" />}

      {found && (
        <>
          <div className="text-[13px] text-[var(--color-slate)]">
            <b className="text-[var(--color-teal)]">{t("targets.found", { n: nf(found.length) })}</b>{t("targets.foundHint")}{" "}
            <button onClick={copyList} className="inline-flex items-center gap-1 text-[var(--color-teal)] font-bold"><Ic n="copy" s={14} />{t("targets.copy")}</button>
          </div>
          <div className="max-h-[42vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
            {found.slice(0, 400).map((u, i) => (
              <a key={u.pk} href={`https://instagram.com/${u.username}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
                <span className="w-6 text-[11px] text-[var(--color-slate)] text-right">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-[13px]">@{u.username}{u.full ? <span className="text-[var(--color-slate)] text-[12px]"> · {u.full}</span> : null}</span>
                {u.verif && <span className="text-[var(--color-teal)]"><Ic n="badge" s={13} label={t("a11y.verified")} /></span>}
                {u.priv && <span className="text-[var(--color-slate)]"><Ic n="lock" s={13} label={t("a11y.private")} /></span>}
                <span className="text-[var(--color-slate)]"><Ic n="external" s={14} /></span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
