import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import { Select } from "../Select";
import SessionError from "../SessionError";

type Progress = { count: number; total: number; code: string; caption: string; thumb: string; is_video: boolean };

// Item dos salvos (espelha ig_api::SavedItem no Rust).
type SavedItem = {
  code: string;
  media_id: string;
  is_video: boolean;
  thumb: string;
  caption: string;
  taken_at: number;
  collection: string;
};
type SavedResult = { items: SavedItem[]; next: string; throttled: boolean };
type Collection = { id: string; name: string; count: number };
type Mode = "all" | "collection";

// status por item: "queued" = na fila · "done"/detalhe = já virou nota detalhada no vault
type Rec = { s: "queued" | "done"; c: string; v?: string; n?: string; detalhe?: boolean; vault?: string };
type Quartzo = { installed: boolean; pro: boolean; kind: string };

// Caixa de entrada única do 2º cérebro (fora do repo — é conhecimento, vai no Drive).
const INBOX = "G:/Meu Drive/VAULTS/_INBOX-SALVOS";
const QUEUE = `${INBOX}/_A-PROCESSAR.jsonl`;
const STATE = `${INBOX}/_FILA-ESTADO.json`;
const ROUTER = `${INBOX}/_ROTEADOR.md`;
const FILA_MD = `${INBOX}/_FILA.md`;

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
async function readText(path: string): Promise<string | null> {
  try {
    const bytes = await invoke<number[]>("read_bytes", { path });
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null; // não existe ainda
  }
}
async function writeText(path: string, text: string) {
  await invoke("write_bytes", { path, bytes: enc(text) });
}

const igUrl = (code: string) => `https://www.instagram.com/p/${code}/`;

const ROUTER_MD = `---
tipo: roteador
tags: [inbox, segundo-cerebro, instagram, salvos]
---

# _ROTEADOR — como absorver a fila dos Salvos

Fila: \`_A-PROCESSAR.jsonl\` (1 item/linha: code, url, is_video, caption, thumb, collection, added_at).
Estado/status: \`_FILA-ESTADO.json\` (cursor + status por code). Painel legível: \`_FILA.md\`.
O app (Codex IG) só ENFILEIRA. A absorção é da IA (Claude).

## Passos (por item)
1. Tema = nome da \`collection\` se tiver; senão classifica pelo conteúdo (legenda + frames).
   Frames/transcrição: skill \`transcribe-video-url\` na \`url\` (ritmado, best-effort; sem frame → legenda+capa bastam).
2. **Encaixe semântico em vault EXISTENTE primeiro** (\`G:\\Meu Drive\\VAULTS\`). Viés forte a reusar.
   - DaVinci é guarda-chuva de: cor/colorgrading, edição, Fusion, áudio, audiovisual, **plugins de edição**.
     → vault \`WINDOWS - DAVINCI RESOLVE\` (vira receita nos cadernos \`99a-e\` + índice + busca burra).
   - Outros temas → o vault do tema que melhor encaixa.
3. **Vault novo SÓ quando nada existente serve** (domínio genuinamente novo).
   Órfão solitário → nota aqui no \`_INBOX-SALVOS\` com \`tags: [tema]\`; promove a vault próprio ao juntar ~4+ do mesmo tema.
4. Nota no formato Obsidian (frontmatter + [[wikilinks]] + callout): o que é, a sacada, link, ideia.
   Atualizar índice/busca burra do vault. Marcar no \`_FILA-ESTADO.json\` \`{s:"done", v:<vault>, n:<nota>}\` e tirar a linha do \`.jsonl\`.
5. Commit do vault.

Disparo: \`/vault\` ou início de sessão.
`;

export default function Saved() {
  const { t, nf } = useI18n();
  const [mode, setMode] = useState<Mode>("all");
  const [cols, setCols] = useState<Collection[]>([]);
  const [colId, setColId] = useState("");
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [rec, setRec] = useState<Record<string, Rec>>({}); // status por code
  const [cursor, setCursor] = useState("");
  const [prog, setProg] = useState<Progress | null>(null);
  const [disp, setDisp] = useState(0);
  const [absBusy, setAbsBusy] = useState(false);
  const [abs, setAbs] = useState<{ ok: number; skip: number; fail: number; dup: number; finished: boolean; tail: string[] } | null>(null);
  const [qz, setQz] = useState<Quartzo | null>(null); // gate: Quartzo obrigatório
  const [sel, setSel] = useState<Set<string>>(new Set()); // posts selecionados p/ absorver
  // destino da absorção: auto (IA decide) | vault existente | vault novo | da coleção
  const [destMode, setDestMode] = useState<"auto" | "existing" | "new" | "collection">("auto");
  const [vaults, setVaults] = useState<string[]>([]);
  const [destVault, setDestVault] = useState(""); // vault existente escolhido
  const [newVault, setNewVault] = useState(""); // nome do vault novo
  const [canceling, setCanceling] = useState(false); // Cancelar puxar/absorver clicado
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null); // interval do absorb_status

  useEffect(() => { invoke<Quartzo>("quartzo_status").then(setQz).catch(() => setQz({ installed: false, pro: false, kind: "" })); }, []);
  useEffect(() => { invoke<string[]>("list_vaults").then(setVaults).catch(() => { }); }, []);
  // saiu do modo coleção? "da coleção" deixa de valer -> volta pro auto.
  useEffect(() => { if (mode !== "collection" && destMode === "collection") setDestMode("auto"); }, [mode, destMode]);

  // resolve o destino escolhido -> nome do vault (ou undefined = auto/IA decide).
  const collName = () => cols.find((c) => c.id === colId)?.name || "";
  function resolveDest(): string | undefined {
    if (destMode === "existing") return destVault || undefined;
    if (destMode === "new") return newVault.trim() || undefined;
    if (destMode === "collection") return collName() || undefined;
    return undefined; // auto
  }

  const toggleSel = (code: string) => setSel((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  // dispara o motor de absorção (node) e acompanha o progresso pelo log.
  // codes = só os selecionados; senão os últimos 100.
  async function absorb(codes?: string[]) {
    if (!qz?.pro) { setErr(t("saved.qzNeed")); return; }
    setAbsBusy(true); setAbs(null); setErr("");
    try {
      const dest = resolveDest();
      await invoke("absorb_run", { ...(codes && codes.length ? { codes } : { limit: 100 }), dest });
    } catch (e) { setErr(String(e) === "QUARTZO_REQUIRED" ? t("saved.qzNeed") : String(e)); setAbsBusy(false); return; }
    pollRef.current = setInterval(async () => {
      try {
        const s = await invoke<typeof abs>("absorb_status");
        setAbs(s);
        if (s?.finished) { if (pollRef.current) clearInterval(pollRef.current); setAbsBusy(false); reloadRec(); }
      } catch { /* segue */ }
    }, 4000);
  }

  // Cancela a absorção: mata o node no Rust + para o poll + recarrega os badges do que já rodou.
  async function cancelAbsorb() {
    try { await invoke("absorb_cancel"); } catch { /* */ }
    if (pollRef.current) clearInterval(pollRef.current);
    setAbsBusy(false); reloadRec();
  }

  // carrega estado (rec + cursor); migra formato antigo {seen:[]} -> rec.
  useEffect(() => {
    (async () => {
      const raw = await readText(STATE);
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (typeof s.cursor === "string") setCursor(s.cursor);
        if (s.items && typeof s.items === "object") setRec(s.items);
        else if (Array.isArray(s.seen)) {
          const r: Record<string, Rec> = {};
          s.seen.forEach((c: string) => (r[c] = { s: "queued", c: "" }));
          setRec(r);
        }
      } catch { /* corrompido → recomeça */ }
    })();
  }, []);

  useEffect(() => {
    const un = listen<Progress>("saved_progress", (e) => setProg(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (!prog) { setDisp(0); return; }
    const target = prog.count;
    let raf = 0;
    const step = () => setDisp((d) => {
      if (d >= target) return target;
      const nd = d + Math.max(1, Math.ceil((target - d) / 8));
      if (nd < target) raf = requestAnimationFrame(step);
      return Math.min(nd, target);
    });
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [prog?.count]);

  async function loadCollections() {
    try {
      const c = await invoke<Collection[]>("ig_collections");
      setCols(c);
      if (c[0] && !colId) setColId(c[0].id);
    } catch (e) { setErr(String(e)); }
  }
  useEffect(() => { if (mode === "collection" && cols.length === 0) loadCollections(); }, [mode]);

  const doneCount = Object.values(rec).filter((r) => r.s === "done").length;
  const queuedCount = Object.values(rec).filter((r) => r.s === "queued").length;

  // reescreve _FILA.md (painel legível, ordenado) a partir da fila crua (.jsonl) + contagem absorvida.
  async function writeFilaMd(done: number) {
    const raw = (await readText(QUEUE)) || "";
    const lines = raw.split("\n").filter(Boolean);
    const rows = lines.map((l, i) => {
      try {
        const o = JSON.parse(l);
        const cap = String(o.caption || "").replace(/[|\n\r]/g, " ").slice(0, 80) || "—";
        return `| ${i + 1} | ${o.is_video ? "Reel" : "Post"} | ${o.collection || "—"} | ${cap} | [abrir](${o.url}) |`;
      } catch { return ""; }
    }).filter(Boolean);
    const md = `---
tipo: fila-salvos
tags: [inbox, salvos, segundo-cerebro]
---

# Fila dos Salvos — painel

> [!info] ${lines.length} na fila (aguardando virar nota) · ${done} já viraram nota no vault
> Ordenado por quando entrou. A IA processa cada um e move pro vault do tema (DaVinci, etc.).
> Some daqui quando vira nota — aí vive no vault do tema.

| # | Tipo | Tema (coleção) | Legenda | Link |
|---|------|----------------|---------|------|
${rows.join("\n")}
`;
    await writeText(FILA_MD, md);
  }

  // enfileira só os NOVOS (dedup por rec); atualiza .jsonl + _FILA.md + estado.
  async function enqueue(pulled: SavedItem[], cur: Record<string, Rec>): Promise<{ added: number; rec: Record<string, Rec> }> {
    const fresh = pulled.filter((i) => !cur[i.code]);
    if (fresh.length === 0) return { added: 0, rec: cur };
    if ((await readText(ROUTER)) === null) await writeText(ROUTER, ROUTER_MD);
    const prev = (await readText(QUEUE)) || "";
    const addedAt = new Date().toISOString();
    const lines = fresh.map((i) => JSON.stringify({
      code: i.code, media_id: i.media_id, url: igUrl(i.code),
      is_video: i.is_video, caption: i.caption, thumb: i.thumb,
      collection: i.collection, added_at: addedAt,
    }));
    await writeText(QUEUE, (prev.endsWith("\n") || prev === "" ? prev : prev + "\n") + lines.join("\n") + "\n");
    const next = { ...cur };
    fresh.forEach((i) => (next[i.code] = { s: "queued", c: i.collection }));
    await writeFilaMd(Object.values(next).filter((r) => r.s === "done").length);
    return { added: fresh.length, rec: next };
  }

  const saveState = async (r: Record<string, Rec>, cur: string) =>
    writeText(STATE, JSON.stringify({ cursor: cur, items: r }, null, 0));

  // Cancela o "puxar salvos" em andamento (o Rust devolve o parcial + cursor).
  async function cancelPull() {
    setCanceling(true);
    try { await invoke("ig_saved_cancel"); } catch { /* */ }
  }

  async function pull(restart = false) {
    setLoading(true); setErr(""); setMsg(""); setProg(null); setCanceling(false);
    // continuar os "geral" acumula (append); qualquer puxada FRESH (coleção/restart/1ª) LIMPA a lista
    // anterior da tela — senão vira lixo e pesa o render.
    const continuingAll = mode === "all" && !restart && !!cursor;
    if (!continuingAll) { setItems([]); setSel(new Set()); }
    try {
      if (mode === "collection") {
        if (!colId) { setErr(t("saved.pickCol")); return; }
        const col = cols.find((c) => c.id === colId);
        const r = await invoke<SavedItem[]>("ig_collection", { id: colId, name: col?.name || "", total: col?.count ?? 0 });
        setItems(r);
        const { added, rec: nr } = await enqueue(r, rec);
        setRec(nr); await saveState(nr, cursor);
        setMsg(added ? t("saved.queued", { n: nf(added) }) : t("saved.nothingNew"));
        return;
      }
      const resume = restart ? "" : cursor;
      const res = await invoke<SavedResult>("ig_saved", { resume });
      setItems((prev) => (resume ? [...prev, ...res.items] : res.items));
      const { added, rec: nr } = await enqueue(res.items, rec);
      setRec(nr); setCursor(res.next); await saveState(nr, res.next);
      if (res.throttled) setMsg(t("saved.throttled", { n: nf(added) }));
      else if (res.next) setMsg(added ? t("saved.more", { n: nf(added) }) : t("saved.moreNoNew"));
      else setMsg(added ? t("saved.doneAll", { n: nf(added) }) : t("saved.nothingNew"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false); setProg(null); setCanceling(false);
    }
  }

  const continuing = mode === "all" && !!cursor;
  const pct = prog && prog.total > 0 ? Math.min(100, Math.round((prog.count / prog.total) * 100)) : 0;

  // recarrega o estado (rec) — pós-absorção os badges viram "✓ no vault".
  async function reloadRec() {
    const raw = await readText(STATE);
    if (!raw) return;
    try { const s = JSON.parse(raw); if (s.items) setRec(s.items); } catch { /* */ }
  }

  const vaultShort = (v?: string) => (v === "WINDOWS - DAVINCI RESOLVE" ? "DaVinci" : v === "ESTUDOS - CONCURSO" ? "Concurso" : v === "IDEIAS SALVAS" ? "Ideias" : v || "");
  // infere o vault pelo nome da nota (itens do motor antigo tinham n mas não vault)
  const inferVault = (r?: Rec) => r?.vault || (/^99[a-z]/.test(r?.n || "") ? "WINDOWS - DAVINCI RESOLVE" : /concurso|estudo/i.test(r?.n || "") ? "ESTUDOS - CONCURSO" : /\bIA\b|ideia/i.test(r?.n || "") ? "IDEIAS SALVAS" : "");
  const isAbsorbed = (r?: Rec) => !!(r && (r.detalhe || (r as any).receita) && r.n && r.n !== "(skip)" && r.n !== "(sem mídia)" && r.n !== "(sem vídeo/foto)" && r.n !== "(foto/sem-vídeo)");

  // formata linha do log do motor -> linha amigável (sem código cru) pro painel
  const fmtLine = (l: string): { icon: string; cls: string; text: string; vault?: string } | null => {
    let m = l.match(/^\[ok:(.+?)\]\s+\S+\s+—\s+(.+)$/);
    if (m) return { icon: "✓", cls: "text-[#3ad07a]", text: m[2], vault: vaultShort(m[1]) };
    m = l.match(/^\[skip\]\s+\S+(?:\s+—\s+(.+))?$/);
    if (m) return { icon: "·", cls: "text-[var(--color-slate)]", text: t("saved.lgSkip") + (m[1] ? ": " + m[1] : "") };
    m = l.match(/^\[dup\]\s+\S+(?:\s+—\s+(.+))?$/);
    if (m) return { icon: "≡", cls: "text-[var(--color-slate)]", text: t("saved.lgDup") + (m[1] ? ": " + m[1] : "") };
    if (l.startsWith("[fail")) return { icon: "×", cls: "text-[var(--color-coral2)]", text: t("saved.lgFail") };
    return null; // linhas === ... não mostra
  };

  // badge de status de um item na lista
  const badge = (code: string) => {
    const r = rec[code];
    if (isAbsorbed(r)) { const v = inferVault(r); return { label: v ? `✓ ${vaultShort(v)}` : t("saved.bDone"), cls: "border-[#3ad07a]/50 text-[#3ad07a]" }; }
    if (r && (r.detalhe || (r as any).receita)) return { label: t("saved.bSkip"), cls: "border-[var(--color-steel)] text-[var(--color-slate)]" }; // skip/sem mídia
    if (!r) return { label: t("saved.bNew"), cls: "border-[var(--color-teal)] text-[var(--color-teal2)]" };
    return { label: t("saved.bQueued"), cls: "border-[var(--color-steel)] text-[var(--color-slate)]" };
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <p className="mb-3 text-[13px] leading-snug text-[var(--color-slate)]">{t("saved.intro")}</p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.mode")}</span>
            <Select ariaLabel={t("saved.mode")} value={mode} onChange={(v) => setMode(v as Mode)} disabled={loading || absBusy}
              options={[{ value: "all", label: t("saved.mAll") }, { value: "collection", label: t("saved.mCollection") }]} />
          </div>

          {mode === "collection" && (
            <div className="min-w-[200px]">
              <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.collection")}</span>
              <Select ariaLabel={t("saved.collection")} value={colId} onChange={setColId} disabled={loading || absBusy}
                options={cols.length ? cols.map((c) => ({ value: c.id, label: `${c.name} (${c.count})` })) : [{ value: "", label: t("saved.noCols") }]} />
            </div>
          )}

          <button onClick={() => pull(false)} disabled={loading || absBusy}
            className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">
            {loading ? t("saved.pulling") : continuing ? t("saved.continue") : t("saved.pull")}
          </button>

          {loading && (
            <button onClick={cancelPull} disabled={canceling}
              className="rounded-xl border border-[var(--color-coral2)]/50 bg-[#1a0e0c] px-3.5 py-2.5 text-[12.5px] font-bold text-[var(--color-coral2)] hover:brightness-110 disabled:opacity-50">
              {canceling ? t("saved.canceling") : t("saved.cancel")}
            </button>
          )}

          {continuing && !loading && !absBusy && (
            <button onClick={() => pull(true)}
              className="rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2.5 text-[12.5px] font-bold text-[var(--color-slate)]">
              {t("saved.restart")}
            </button>
          )}
        </div>

        {/* placar do 2º cérebro: na fila vs já no vault */}
        {(queuedCount > 0 || doneCount > 0) && (
          <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--color-line)] pt-3 text-[12.5px]">
            <span className="text-[var(--color-slate)]">{t("saved.statQueued")}: <b className="text-[var(--color-paper)] tabular-nums">{nf(queuedCount)}</b></span>
            <span className="text-[var(--color-slate)]">{t("saved.statDone")}: <b className="text-[#3ad07a] tabular-nums">{nf(doneCount)}</b></span>
            <span className="text-[var(--color-slate)]">{t("saved.filaHint")}</span>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-snug text-[var(--color-slate)]">{t("saved.note")}</p>
      </div>

      {/* GATE: Quartzo (comprado+instalado) é obrigatório pra essa feature */}
      {qz && !qz.pro && (
        <div className="rounded-2xl border border-[#7c3aed]/40 bg-[linear-gradient(135deg,#160f2b,#0e1522)] p-5">
          <div className="text-[13.5px] font-bold text-[#c4b5fd]">{t("saved.qzTitle")}</div>
          <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-slate)]">
            {qz.installed ? t("saved.qzInstalledNoPro") : t("saved.qzNotInstalled")}
          </p>
          <a href="https://quartzo.app" target="_blank" rel="noreferrer"
            className="mt-3 inline-block rounded-xl bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-5 py-2.5 font-bold text-white hover:brightness-110">
            {t("saved.qzBtn")}
          </a>
        </div>
      )}

      {/* Absorver: vira os salvos em RECEITA no vault, automático (visão IA) — só com Quartzo Pro */}
      <div className={"rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 " + (qz && !qz.pro ? "pointer-events-none opacity-50" : "")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-[var(--color-paper)]">{t("saved.absTitle")}</div>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-slate)]">{t("saved.absIntro")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {sel.size > 0 && !absBusy && (
              <button onClick={() => absorb([...sel])} disabled={loading}
                className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-4 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">
                {t("saved.absSel", { n: nf(sel.size) })}
              </button>
            )}
            <button onClick={() => absorb()} disabled={absBusy || loading}
              className="rounded-xl bg-[linear-gradient(135deg,#a855f7,#7c3aed)] px-5 py-2.5 font-bold text-white hover:brightness-110 active:scale-[.99] disabled:opacity-50">
              {absBusy ? t("saved.absRunning") : t("saved.absBtn")}
            </button>
            {absBusy && (
              <button onClick={cancelAbsorb}
                className="rounded-xl border border-[var(--color-coral2)]/50 bg-[#1a0e0c] px-4 py-2.5 font-bold text-[var(--color-coral2)] hover:brightness-110">
                {t("saved.cancel")}
              </button>
            )}
          </div>
        </div>

        {/* DESTINO: o usuário decide onde as notas vão parar (ou deixa a IA escolher) */}
        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.destLabel")}</div>
          <div className="flex flex-wrap items-end gap-3">
            <Select ariaLabel={t("saved.destLabel")} value={destMode} onChange={(v) => setDestMode(v as typeof destMode)} disabled={absBusy || loading}
              options={[
                { value: "auto", label: t("saved.destAuto") },
                { value: "existing", label: t("saved.destExisting") },
                { value: "new", label: t("saved.destNew") },
                ...(mode === "collection" && colId ? [{ value: "collection", label: t("saved.destColl") }] : []),
              ]} />
            {destMode === "existing" && (
              <div className="min-w-[220px]">
                <Select ariaLabel={t("saved.destPick")} value={destVault} onChange={setDestVault} disabled={absBusy || loading}
                  options={vaults.length ? vaults.map((v) => ({ value: v, label: v })) : [{ value: "", label: t("saved.destNoVaults") }]} />
              </div>
            )}
            {destMode === "new" && (
              <input value={newVault} onChange={(e) => setNewVault(e.target.value)} placeholder={t("saved.destNewPh")} disabled={absBusy || loading}
                className="min-w-[220px] rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)] disabled:opacity-40" />
            )}
            {destMode === "collection" && (
              <span className="rounded-full border border-[var(--color-steel)] px-3 py-1.5 text-[12px] text-[var(--color-paper)]">{collName() || "—"}</span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-slate)]">{t("saved.destHint")}</p>
        </div>

        {(abs || absBusy) && (
          <div className="pop mt-4 rounded-xl border border-[#7c3aed]/30 bg-[#0e1522] p-4">
            <div className="mb-3 flex items-center gap-2">
              {absBusy && !abs?.finished && <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#a855f7]" />}
              <span className="text-[13px] font-bold text-[var(--color-paper)]">
                {abs?.finished ? t("saved.absDone") : t("saved.absRunning")}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              <span className="text-[var(--color-slate)]">{t("saved.absOk")}: <b className="text-[#3ad07a] tabular-nums">{nf(abs?.ok || 0)}</b></span>
              <span className="text-[var(--color-slate)]">{t("saved.absSkip")}: <b className="text-[var(--color-paper)] tabular-nums">{nf(abs?.skip || 0)}</b></span>
              <span className="text-[var(--color-slate)]">{t("saved.absDup")}: <b className="text-[var(--color-paper)] tabular-nums">{nf(abs?.dup || 0)}</b></span>
              <span className="text-[var(--color-slate)]">{t("saved.absFail")}: <b className="text-[var(--color-coral2)] tabular-nums">{nf(abs?.fail || 0)}</b></span>
            </div>
            {abs?.tail?.length ? (
              <div className="mt-3 max-h-44 space-y-1 overflow-auto">
                {abs.tail.map(fmtLine).filter(Boolean).reverse().map((r, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[12px]">
                    <span className={"shrink-0 font-bold " + r!.cls}>{r!.icon}</span>
                    <span className="truncate text-[var(--color-ink)]">{r!.text}</span>
                    {r!.vault ? <span className="ml-auto shrink-0 text-[10.5px] text-[var(--color-slate)]">{r!.vault}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-snug text-[var(--color-slate)]">{t("saved.absNote")}</p>
      </div>

      {err && <SessionError err={err} onRetry={() => pull(false)} failedKey="saved.failed" />}
      {msg && <div className="pop rounded-xl border border-[var(--color-teal)]/40 bg-[#08201c] px-4 py-3 text-[13px] text-[var(--color-teal2)]">{msg}</div>}

      {loading && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <div className="flex items-center gap-4">
            {prog?.thumb ? <img src={prog.thumb} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              : <div className="h-16 w-16 shrink-0 rounded-lg bg-[#0e1522]" />}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.transferring")}</div>
              <div className="text-[26px] font-bold leading-tight tabular-nums text-[var(--color-paper)]">
                {nf(disp)}{prog && prog.total > 0 ? <span className="text-[var(--color-slate)]"> / {nf(prog.total)}</span> : null}
                <span className="ml-2 align-middle text-[12px] font-normal text-[var(--color-slate)]">{t("saved.pulledUnit")}</span>
              </div>
              <div className="mt-0.5 truncate text-[12px] text-[var(--color-slate)]">{prog?.caption || t("saved.pulling")}</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#0e1522]">
            {prog && prog.total > 0
              ? <div className="h-full rounded-full bg-[linear-gradient(90deg,#00e5c9,#7ef7e6)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
              : <div className="skel h-full w-full" />}
          </div>
          <div className="mt-2 text-[11px] text-[var(--color-slate)]">{t("saved.transferNote")}</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          <span className="text-[13px] text-[var(--color-slate)]">{t("saved.found", { n: nf(items.length) })}</span>
          <div className="stagger space-y-2">
            {items.map((it, i) => {
              const b = badge(it.code);
              const rr = rec[it.code];
              const absorbed = !!(rr && (rr.detalhe || (rr as any).receita));
              return (
                <div key={it.code + i} className={"flex items-center gap-3 rounded-xl border bg-[var(--color-panel)] p-3 transition hover:border-[var(--color-steel)] " + (sel.has(it.code) ? "border-[var(--color-teal)]" : "border-[var(--color-line)]")}>
                  <input type="checkbox" title={t("saved.selHint")} checked={sel.has(it.code)} disabled={absorbed || !qz?.pro || loading || absBusy}
                    onChange={() => toggleSel(it.code)}
                    className="h-4 w-4 shrink-0 accent-[var(--color-teal)] disabled:opacity-30" />
                  {it.thumb ? <img src={it.thumb} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-[#0e1522]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a href={igUrl(it.code)} target="_blank" rel="noreferrer" className="truncate text-[13.5px] font-bold text-[var(--color-teal2)] hover:underline">
                        {it.is_video ? t("saved.reel") : t("saved.post")} · {it.code}
                      </a>
                      {it.collection ? <span className="shrink-0 rounded-full border border-[var(--color-steel)] px-2 py-0.5 text-[10.5px] text-[var(--color-slate)]">{it.collection}</span> : null}
                      <span className={"ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold " + b.cls}>{b.label}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-ink)]">{it.caption || t("saved.noCaption")}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
