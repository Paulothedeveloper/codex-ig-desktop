import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";
import { Select } from "../Select";

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

// Caixa de entrada única do 2º cérebro (fora do repo — é conhecimento, vai no Drive).
const INBOX = "G:/Meu Drive/VAULTS/_INBOX-SALVOS";
const QUEUE = `${INBOX}/_A-PROCESSAR.jsonl`;
const STATE = `${INBOX}/_FILA-ESTADO.json`;
const ROUTER = `${INBOX}/_ROTEADOR.md`;

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

// Regras de roteamento — gravadas 1x pra QUALQUER sessão absorver igual.
const ROUTER_MD = `---
tipo: roteador
tags: [inbox, segundo-cerebro, instagram, salvos]
---

# _ROTEADOR — como absorver a fila dos Salvos

Fila: \`_A-PROCESSAR.jsonl\` (1 item/linha: code, url, is_video, caption, thumb, collection, added_at).
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
   NÃO criar vault pra qualquer coisa.
4. Nota no formato Obsidian (frontmatter + [[wikilinks]] + callout): o que é, a sacada/por que presta, link, ideia.
   Atualizar índice/busca burra do vault. Marcar processado (tirar a linha do \`.jsonl\`; \`_FILA-ESTADO.json\` mantém o \`seen\` pra não re-enfileirar).
5. Commit do vault.

Disparo: \`/vault\` ou início de sessão. (Automático total = agendar depois.)
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
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(""); // "" = do topo; senão continua o backlog

  // carrega o estado da fila (seen + cursor), 1x.
  useEffect(() => {
    (async () => {
      const raw = await readText(STATE);
      if (raw) {
        try {
          const s = JSON.parse(raw);
          if (Array.isArray(s.seen)) setSeen(new Set(s.seen));
          if (typeof s.cursor === "string") setCursor(s.cursor);
        } catch { /* estado corrompido → recomeça vazio */ }
      }
    })();
  }, []);

  async function loadCollections() {
    try {
      const c = await invoke<Collection[]>("ig_collections");
      setCols(c);
      if (c[0] && !colId) setColId(c[0].id);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => { if (mode === "collection" && cols.length === 0) loadCollections(); }, [mode]);

  // enfileira itens novos (dedup por seen); devolve quantos entraram + o novo seen.
  async function enqueue(pulled: SavedItem[], curSeen: Set<string>): Promise<{ added: number; seen: Set<string> }> {
    const fresh = pulled.filter((i) => !curSeen.has(i.code));
    if (fresh.length === 0) return { added: 0, seen: curSeen };
    if ((await readText(ROUTER)) === null) await writeText(ROUTER, ROUTER_MD);
    const prev = (await readText(QUEUE)) || "";
    const addedAt = new Date().toISOString();
    const lines = fresh.map((i) =>
      JSON.stringify({
        code: i.code, media_id: i.media_id, url: igUrl(i.code),
        is_video: i.is_video, caption: i.caption, thumb: i.thumb,
        collection: i.collection, added_at: addedAt,
      })
    );
    const next = (prev.endsWith("\n") || prev === "" ? prev : prev + "\n") + lines.join("\n") + "\n";
    await writeText(QUEUE, next);
    const nextSeen = new Set(curSeen);
    fresh.forEach((i) => nextSeen.add(i.code));
    return { added: fresh.length, seen: nextSeen };
  }

  const saveState = async (s: Set<string>, cur: string) =>
    writeText(STATE, JSON.stringify({ seen: [...s], cursor: cur }, null, 0));

  async function pull(restart = false) {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      if (mode === "collection") {
        if (!colId) { setErr(t("saved.pickCol")); return; }
        const name = cols.find((c) => c.id === colId)?.name || "";
        const r = await invoke<SavedItem[]>("ig_collection", { id: colId, name });
        setItems(r);
        const { added, seen: ns } = await enqueue(r, seen);
        setSeen(ns);
        await saveState(ns, cursor);
        setMsg(added ? t("saved.queued", { n: nf(added) }) : t("saved.nothingNew"));
        return;
      }
      // modo "todos": chunk + resume (drena backlog sem perder parcial no throttle)
      const resume = restart ? "" : cursor;
      const res = await invoke<SavedResult>("ig_saved", { resume });
      // acumula no display quando é continuação; recomeça quando restart/topo
      setItems((prev) => (resume ? [...prev, ...res.items] : res.items));
      const { added, seen: ns } = await enqueue(res.items, seen);
      setSeen(ns);
      setCursor(res.next);
      await saveState(ns, res.next);
      if (res.throttled) setMsg(t("saved.throttled", { n: nf(added) }));
      else if (res.next) setMsg(t("saved.more", { n: nf(added) }));
      else setMsg(added ? t("saved.doneAll", { n: nf(added) }) : t("saved.nothingNew"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const continuing = mode === "all" && !!cursor;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <p className="mb-3 text-[13px] leading-snug text-[var(--color-slate)]">{t("saved.intro")}</p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.mode")}</span>
            <Select
              ariaLabel={t("saved.mode")}
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { value: "all", label: t("saved.mAll") },
                { value: "collection", label: t("saved.mCollection") },
              ]}
            />
          </div>

          {mode === "collection" && (
            <div className="min-w-[200px]">
              <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("saved.collection")}</span>
              <Select
                ariaLabel={t("saved.collection")}
                value={colId}
                onChange={setColId}
                options={cols.length
                  ? cols.map((c) => ({ value: c.id, label: `${c.name} (${c.count})` }))
                  : [{ value: "", label: t("saved.noCols") }]}
              />
            </div>
          )}

          <button
            onClick={() => pull(false)}
            disabled={loading}
            className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50"
          >
            {loading ? t("saved.pulling") : continuing ? t("saved.continue") : t("saved.pull")}
          </button>

          {continuing && !loading && (
            <button
              onClick={() => pull(true)}
              className="rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2.5 text-[12.5px] font-bold text-[var(--color-slate)]"
            >
              {t("saved.restart")}
            </button>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-snug text-[var(--color-slate)]">{t("saved.note")}</p>
      </div>

      {err && <div className="rounded-xl border border-[#43221d] bg-[#1a0e0c] px-4 py-3 text-[13px] text-[var(--color-coral2)]">{err}</div>}
      {msg && <div className="pop rounded-xl border border-[var(--color-teal)]/40 bg-[#08201c] px-4 py-3 text-[13px] text-[var(--color-teal2)]">{msg}</div>}

      {loading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-20" />)}</div>}

      {items.length > 0 && (
        <div className="space-y-3">
          <span className="text-[13px] text-[var(--color-slate)]">{t("saved.found", { n: nf(items.length) })}</span>
          <div className="stagger space-y-2">
            {items.map((it, i) => (
              <div key={it.code + i} className="flex gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 transition hover:border-[var(--color-steel)]">
                {it.thumb ? <img src={it.thumb} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-[#0e1522]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a href={igUrl(it.code)} target="_blank" rel="noreferrer" className="truncate text-[13.5px] font-bold text-[var(--color-teal2)] hover:underline">
                      {it.is_video ? t("saved.reel") : t("saved.post")} · {it.code}
                    </a>
                    {it.collection ? <span className="shrink-0 rounded-full border border-[var(--color-steel)] px-2 py-0.5 text-[10.5px] text-[var(--color-slate)]">{it.collection}</span> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-ink)]">{it.caption || t("saved.noCaption")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
