import { useState, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Ic } from "../icons";
import { useI18n } from "../i18n";
import { useConfirm } from "../Confirm";
import { ensureAccount, logUnfollow } from "../db";
import SessionError from "../SessionError";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type Graph = { following_count: number; followers_count: number; non_followers: IgUser[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (b: number) => b + Math.floor(Math.random() * b * 0.45);
const WL_KEY = "codexig_whitelist";
const getWl = (): Set<string> => new Set(JSON.parse(localStorage.getItem(WL_KEY) || "[]"));
const saveWl = (s: Set<string>) => localStorage.setItem(WL_KEY, JSON.stringify([...s]));

function risk(delay: number, cap: number, batch: number, pause: number) {
  let s = 0;
  s += delay < 3 ? 3 : delay < 5 ? 1 : 0;
  s += cap > 300 ? 3 : cap > 150 ? 1 : 0;
  s += batch > 70 ? 2 : batch > 50 ? 1 : 0;
  s += pause < 45 ? 2 : pause < 90 ? 1 : 0;
  if (s <= 1) return { lvlKey: "clean.riskSafe", col: "#00e5c9", pct: 28, msgKey: "clean.riskSafeMsg" };
  if (s <= 4) return { lvlKey: "clean.riskMod", col: "#ffcf4d", pct: 62, msgKey: "clean.riskModMsg" };
  return { lvlKey: "clean.riskAggr", col: "#ff4d3d", pct: 100, msgKey: "clean.riskAggrMsg" };
}

export default function Limpar() {
  const { t, nf } = useI18n();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [wl, setWl] = useState<Set<string>>(getWl());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [cap, setCap] = useState(150);
  const [delay, setDelay] = useState(4);
  const [batch, setBatch] = useState(50);
  const [pause, setPause] = useState(120);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false); // lido DENTRO do loop async (setState não atualiza a closure em execução)
  const [prog, setProg] = useState(0);
  const [log, setLog] = useState<{ k: "ok" | "warn" | "info"; t: string }[]>([]);

  async function load() {
    setLoading(true); setErr("");
    try {
      const g = await invoke<Graph>("ig_graph");
      setGraph(g);
      setSel(new Set(g.non_followers.filter((u) => !wl.has(u.pk)).map((u) => u.pk)));
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  const list = useMemo(() => {
    if (!graph) return [];
    const f = filter.trim().toLowerCase();
    return graph.non_followers
      .filter((u) => !wl.has(u.pk))
      .filter((u) => !f || u.username.toLowerCase().includes(f) || (u.full || "").toLowerCase().includes(f));
  }, [graph, wl, filter]);

  const protectedCount = graph ? graph.non_followers.filter((u) => wl.has(u.pk)).length : 0;
  const r = risk(delay, cap, batch, pause);
  const addLog = (k: "ok" | "warn" | "info", t: string) => setLog((l) => [{ k, t }, ...l].slice(0, 200));

  function toggleWl(pk: string) {
    const s = new Set(wl);
    s.has(pk) ? s.delete(pk) : s.add(pk);
    setWl(s); saveWl(s);
    const ns = new Set(sel); ns.delete(pk); setSel(ns);
  }
  function toggleSel(pk: string) {
    const s = new Set(sel); s.has(pk) ? s.delete(pk) : s.add(pk); setSel(s);
  }

  async function run() {
    if (running) { stopRef.current = true; return; } // PARAR: ref lido dentro do loop
    const marked = list.filter((u) => sel.has(u.pk)).slice(0, Math.max(1, cap));
    if (!marked.length) { addLog("info", t("clean.nothingMarked")); return; }
    if (!(await confirm({ body: t("clean.confirm", { n: marked.length, d: delay, p: pause, b: batch }), danger: true }))) return;
    setRunning(true); stopRef.current = false; setProg(0); setLog([]);

    // conta pra trilha de auditoria local (unfollow_log); se falhar, segue sem log
    let accountId: number | null = null;
    try { accountId = await ensureAccount(await invoke<string>("ig_session_ok")); } catch { /* sem log */ }

    const removed = new Set<string>(); // só os REALMENTE deixados de seguir
    let stop = false;
    let ok = 0;
    for (let i = 0; i < marked.length; i++) {
      if (stopRef.current || stop) break;
      const u = marked[i];
      try {
        await invoke("ig_destroy", { pk: u.pk });
        ok++; removed.add(u.pk);
        addLog("ok", `@${u.username} (${ok}/${marked.length})`);
        if (accountId != null) logUnfollow(accountId, u.pk, u.username, "ok").catch(() => {});
      } catch (e) {
        const msg = String(e);
        if (accountId != null) logUnfollow(accountId, u.pk, u.username, msg.slice(0, 80)).catch(() => {});
        if (msg.includes("BLOCK") || msg.includes("ig_rate_limited")) { addLog("warn", t("clean.blocked", { m: msg })); stop = true; break; }
        addLog("warn", `@${u.username}: ${msg}`);
      }
      setProg(((i + 1) / marked.length) * 100);
      if (ok > 0 && ok % batch === 0 && i < marked.length - 1) {
        for (let s = pause; s > 0 && !stopRef.current; s--) { addLog("info", t("clean.pauseTick", { s })); await sleep(1000); }
      } else {
        await sleep(jitter(delay * 1000));
      }
    }
    addLog("info", t("clean.done", { n: ok }));
    setRunning(false); stopRef.current = false;
    // remove da lista SÓ quem foi realmente deixado de seguir (não os que deram erro/não alcançados)
    if (graph && removed.size) setGraph({ ...graph, non_followers: graph.non_followers.filter((u) => !removed.has(u.pk)) });
  }

  return (
    <div className="space-y-4">
      {!graph && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
          <p className="text-[var(--color-slate)] text-sm max-w-md mx-auto">
            {t("clean.login", { win: t("win.name") })}
          </p>
          <button onClick={load} disabled={loading} className="mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 disabled:opacity-50">
            {loading && <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-[#04120f]/30 border-t-[#04120f] spin" />}
            {loading ? t("clean.loading") : t("clean.loadBtn")}
          </button>
          {err && <div className="mt-4 text-left"><SessionError err={err} onRetry={load} failedKey="clean.failed" /></div>}
        </div>
      )}

      {graph && (
        <>
          <div className="text-[13px] text-[var(--color-slate)]">
            {t("clean.summary", { a: nf(graph.following_count), b: nf(graph.followers_count), c: nf(graph.non_followers.length) })}
            {protectedCount ? t("clean.protected", { n: protectedCount }) : ""}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([["clean.qty", cap, setCap], ["clean.delay", delay, setDelay], ["clean.batch", batch, setBatch], ["clean.pause", pause, setPause]] as const).map(([lbl, val, set]) => (
              <label key={lbl} className="text-[11px] text-[var(--color-slate)] font-semibold">
                {t(lbl)}
                <input type="number" value={val} onChange={(e) => (set as any)(Math.max(1, +e.target.value))} className="mt-1 w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-[var(--color-paper)] focus:border-[var(--color-teal)] outline-none" />
              </label>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--color-line)] bg-[#0a0f18] p-3">
            <div className="flex justify-between text-[11px] font-bold"><span className="text-[var(--color-slate)]">{t("clean.pace")}</span><span style={{ color: r.col }}>{t(r.lvlKey)}</span></div>
            <div className="h-2 rounded bg-[#141d29] mt-2 overflow-hidden"><div style={{ width: r.pct + "%", background: r.col }} className="h-full rounded transition-all" /></div>
            <div className="text-[11px] text-[var(--color-slate)] mt-2">{t(r.msgKey)}</div>
          </div>

          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("clean.filter")} className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] focus:border-[var(--color-teal)] outline-none" />
          <div className="text-[12px] text-[var(--color-slate)]">
            <button onClick={() => setSel(new Set(list.map((u) => u.pk)))} className="text-[var(--color-teal)] font-bold">{t("clean.selectAll")}</button> ·{" "}
            <button onClick={() => setSel(new Set())} className="text-[var(--color-teal)] font-bold">{t("clean.selectNone")}</button> ·{" "}
            <span>{t("clean.selected", { n: sel.size })}</span> · <span className="text-[10.5px]">{t("clean.starHint")}</span>
          </div>

          <div className="max-h-[38vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
            {list.map((u) => (
              <label key={u.pk} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/5">
                <input type="checkbox" checked={sel.has(u.pk)} onChange={() => toggleSel(u.pk)} className="accent-[var(--color-teal)]" />
                <a href={`https://instagram.com/${u.username}`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-[13px] hover:text-[var(--color-teal)] inline-flex items-center gap-1">
                  <span className="truncate pii">@{u.username}</span>
                  {u.verif && <span className="text-[var(--color-teal)]"><Ic n="badge" s={13} label={t("a11y.verified")} /></span>}
                  {u.priv && <span className="text-[var(--color-slate)]"><Ic n="lock" s={13} label={t("a11y.private")} /></span>}
                </a>
                <button onClick={(e) => { e.preventDefault(); toggleWl(u.pk); }} title={t("clean.protectTitle")} aria-label={t("clean.protectAria", { u: u.username })} className="text-[#5f6f82] hover:text-[#ffcf4d]"><Ic n="star" s={16} fill /></button>
              </label>
            ))}
            {!list.length && <div className="text-[var(--color-slate)] text-[13px] p-2">{t("clean.empty")}</div>}
          </div>

          {running && <div className="h-2 rounded bg-[#141d29] overflow-hidden"><div style={{ width: prog + "%" }} className="h-full bg-[linear-gradient(90deg,#00e5c9,#7ef7e6)] transition-all" /></div>}

          <button onClick={run} className={"w-full rounded-xl py-3 font-bold " + (running ? "bg-[linear-gradient(135deg,#ff4d3d,#e0392b)] text-white" : "bg-[linear-gradient(135deg,#ff4d3d,#e0392b)] text-white hover:brightness-110")}>
            {running ? t("clean.stop") : t("clean.run")}
          </button>

          {log.length > 0 && (
            <div className="max-h-[16vh] overflow-auto text-[12px] text-[var(--color-slate)] leading-relaxed">
              {log.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {l.k === "ok" && <span className="text-[var(--color-teal)]"><Ic n="check" s={13} /></span>}
                  {l.k === "warn" && <span className="text-[var(--color-coral2)]"><Ic n="warn" s={13} /></span>}
                  <span className={l.k === "warn" ? "text-[var(--color-coral2)]" : ""}>{l.t}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
