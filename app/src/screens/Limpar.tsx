import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Ic } from "../icons";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
type Graph = { following_count: number; followers_count: number; non_followers: IgUser[] };

const nf = new Intl.NumberFormat("pt-BR");
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
  if (s <= 1) return { lvl: "Seguro", col: "#00e5c9", pct: 28, msg: "Ritmo humano. Baixo risco." };
  if (s <= 4) return { lvl: "Moderado", col: "#ffcf4d", pct: 62, msg: "Dá pra usar, fique de olho. Para sozinho no bloqueio." };
  return { lvl: "Agressivo", col: "#ff4d3d", pct: 100, msg: "Risco real de bloqueio temporário. IG limita ~200/dia. Você assume." };
}

export default function Limpar() {
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
  const [stopReq, setStopReq] = useState(false);
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
    if (running) { setStopReq(true); return; }
    const marked = list.filter((u) => sel.has(u.pk)).slice(0, Math.max(1, cap));
    if (!marked.length) { addLog("info", "Nada marcado."); return; }
    if (!confirm(`Deixar de seguir ${marked.length} conta(s)? ~${delay}s cada, pausa de ${pause}s a cada ${batch}. Clique de novo pra PARAR.`)) return;
    setRunning(true); setStopReq(false); setProg(0); setLog([]);
    let stop = false;
    let ok = 0;
    for (let i = 0; i < marked.length; i++) {
      if (stopReq || stop) break;
      const u = marked[i];
      try {
        await invoke("ig_destroy", { pk: u.pk });
        ok++;
        addLog("ok", `@${u.username} (${ok}/${marked.length})`);
      } catch (e) {
        const msg = String(e);
        if (msg.includes("BLOCK")) { addLog("warn", `IG bloqueou (${msg}) — PARANDO. Volte amanhã.`); stop = true; break; }
        addLog("warn", `@${u.username}: ${msg}`);
      }
      setProg(((i + 1) / marked.length) * 100);
      if (ok > 0 && ok % batch === 0 && i < marked.length - 1) {
        for (let s = pause; s > 0 && !stopReq; s--) { addLog("info", `pausa ${s}s…`); await sleep(1000); }
      } else {
        await sleep(jitter(delay * 1000));
      }
    }
    addLog("info", `Fim: ${ok} deixados de seguir.`);
    setRunning(false); setStopReq(false);
    // remove os que sairam da lista
    if (graph) setGraph({ ...graph, non_followers: graph.non_followers.filter((u) => !(sel.has(u.pk) && ok > 0)) });
  }

  return (
    <div className="space-y-4">
      {!graph && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center">
          <p className="text-[var(--color-slate)] text-sm max-w-md mx-auto">
            Faça login na janela <b className="text-[var(--color-paper)]">Codex IG — Instagram</b>. Aqui você limpa quem <b className="text-[var(--color-paper)]">não te segue de volta</b>, no teu ritmo, com whitelist e parada automática.
          </p>
          <button onClick={load} disabled={loading} className="mt-4 rounded-xl px-5 py-2.5 font-extrabold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 disabled:opacity-50">
            {loading ? "Lendo tua sessão…" : "Carregar quem não retribui"}
          </button>
          {err && <div className="mt-3 text-[13px] text-[var(--color-coral2)]">Falhou: {err}</div>}
        </div>
      )}

      {graph && (
        <>
          <div className="text-[13px] text-[var(--color-slate)]">
            Segue <b className="text-[var(--color-paper)]">{nf.format(graph.following_count)}</b> · te segue <b className="text-[var(--color-paper)]">{nf.format(graph.followers_count)}</b> · não retribuem <b className="text-[var(--color-coral2)]">{nf.format(graph.non_followers.length)}</b>{protectedCount ? <> · <b className="text-[var(--color-teal2)]">{protectedCount}</b> protegidos</> : null}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([["Quantidade", cap, setCap], ["Delay (s)", delay, setDelay], ["Lote", batch, setBatch], ["Pausa (s)", pause, setPause]] as const).map(([lbl, val, set]) => (
              <label key={lbl} className="text-[11px] text-[var(--color-slate)] font-semibold">
                {lbl}
                <input type="number" value={val} onChange={(e) => (set as any)(Math.max(1, +e.target.value))} className="mt-1 w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-[var(--color-paper)] focus:border-[var(--color-teal)] outline-none" />
              </label>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--color-line)] bg-[#0a0f18] p-3">
            <div className="flex justify-between text-[11px] font-bold"><span className="text-[var(--color-slate)]">Ritmo</span><span style={{ color: r.col }}>{r.lvl}</span></div>
            <div className="h-2 rounded bg-[#141d29] mt-2 overflow-hidden"><div style={{ width: r.pct + "%", background: r.col }} className="h-full rounded transition-all" /></div>
            <div className="text-[11px] text-[var(--color-slate)] mt-2">{r.msg}</div>
          </div>

          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filtrar @usuário…" className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] focus:border-[var(--color-teal)] outline-none" />
          <div className="text-[12px] text-[var(--color-slate)]">
            <button onClick={() => setSel(new Set(list.map((u) => u.pk)))} className="text-[var(--color-teal)] font-bold">marcar todos</button> ·{" "}
            <button onClick={() => setSel(new Set())} className="text-[var(--color-teal)] font-bold">nenhum</button> ·{" "}
            <span>{sel.size} marcados</span> · <span className="text-[10.5px]">estrela = proteger</span>
          </div>

          <div className="max-h-[38vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
            {list.map((u) => (
              <label key={u.pk} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/5">
                <input type="checkbox" checked={sel.has(u.pk)} onChange={() => toggleSel(u.pk)} className="accent-[var(--color-teal)]" />
                <a href={`https://instagram.com/${u.username}`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-[13px] hover:text-[var(--color-teal)] inline-flex items-center gap-1">
                  <span className="truncate">@{u.username}</span>
                  {u.verif && <span className="text-[var(--color-teal)]"><Ic n="badge" s={13} /></span>}
                  {u.priv && <span className="text-[var(--color-slate)]"><Ic n="lock" s={13} /></span>}
                </a>
                <button onClick={(e) => { e.preventDefault(); toggleWl(u.pk); }} title="proteger" aria-label={`Proteger @${u.username} da limpeza`} className="text-[#3a4557] hover:text-[#ffcf4d]"><Ic n="star" s={16} fill /></button>
              </label>
            ))}
            {!list.length && <div className="text-[var(--color-slate)] text-[13px] p-2">Ninguém aqui.</div>}
          </div>

          {running && <div className="h-2 rounded bg-[#141d29] overflow-hidden"><div style={{ width: prog + "%" }} className="h-full bg-[linear-gradient(90deg,#00e5c9,#7ef7e6)] transition-all" /></div>}

          <button onClick={run} className={"w-full rounded-xl py-3 font-extrabold " + (running ? "bg-[linear-gradient(135deg,#ff4d3d,#e0392b)] text-white" : "bg-[linear-gradient(135deg,#ff4d3d,#e0392b)] text-white hover:brightness-110")}>
            {running ? "PARAR" : "Deixar de seguir marcados"}
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
