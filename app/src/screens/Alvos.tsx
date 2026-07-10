import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Ic } from "../icons";

type IgUser = { pk: string; username: string; full: string; priv: boolean; verif: boolean };
const nf = new Intl.NumberFormat("pt-BR");

const MODELOS: Record<string, string> = {
  "Editor / criador": "qual node você usou pro skin tone aí? ficou limpo.",
  "Dev / maker": "boa! tá usando o quê no back? montei um parecido semana passada.",
  "Dono de negócio": "isso resolveria mesmo — quanto tempo levou pra colocar no ar?",
  "Referência do nicho": "trabalho consistente. como você organiza o acervo de projeto?",
};

export default function Alvos() {
  const [inp, setInp] = useState("");
  const [cap, setCap] = useState(300);
  const [seg, setSeg] = useState(Object.keys(MODELOS)[0]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [found, setFound] = useState<IgUser[] | null>(null);

  async function search() {
    const competitors = inp.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
    if (!competitors.length) { setMsg("Digite ao menos um @ de concorrente."); return; }
    setLoading(true); setMsg(""); setFound(null);
    try {
      const r = await invoke<IgUser[]>("ig_targets", { competitors, cap });
      setFound(r);
    } catch (e) { setMsg("Falhou: " + String(e)); } finally { setLoading(false); }
  }

  function copyList() {
    if (!found) return;
    const txt = found.map((u, i) => `${i + 1}. @${u.username} — ${u.full || ""} https://instagram.com/${u.username}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => setMsg("Lista copiada."));
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--color-slate)]">
        Concorrentes/referências do teu nicho (sem @, separados por vírgula) → devolve os <b className="text-[var(--color-paper)]">seguidores deles</b> (teu público), tirando quem você já segue. Você abre, curte 2-3 e comenta o modelo. <b className="text-[var(--color-paper)]">Não interage por você</b> (curtir/comentar em massa por script é o que bane).
      </p>

      <input value={inp} onChange={(e) => setInp(e.target.value)} placeholder="ex: davinciresolve.br, editor.pro" className="w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-3 py-2 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] text-[var(--color-slate)] font-semibold">Amostra/conta
          <input type="number" value={cap} min={50} max={2000} onChange={(e) => setCap(Math.max(50, +e.target.value))} className="mt-1 w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]" />
        </label>
        <label className="text-[11px] text-[var(--color-slate)] font-semibold">Segmento
          <select value={seg} onChange={(e) => setSeg(e.target.value)} className="mt-1 w-full bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]">
            {Object.keys(MODELOS).map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
      </div>

      <button onClick={search} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-extrabold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110 disabled:opacity-50">
        <Ic n="instagram" s={17} />{loading ? "Buscando público real…" : "Buscar público real"}
      </button>

      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 text-[13px]">
        <span className="text-[var(--color-teal)] font-bold">Comentário-modelo ({seg})</span>
        <div className="text-[var(--color-ink)] mt-1">"{MODELOS[seg]}"</div>
        <div className="text-[var(--color-slate)] text-[12px] mt-1">Adapte ao post. Curta 2-3 antes. 10-15/dia, genuíno.</div>
      </div>

      {msg && <div className="text-[13px] text-[var(--color-slate)]">{msg}</div>}

      {found && (
        <>
          <div className="text-[13px] text-[var(--color-slate)]">
            <b className="text-[var(--color-teal)]">{nf.format(found.length)} alvos reais</b> (tirei quem você já segue).{" "}
            <button onClick={copyList} className="inline-flex items-center gap-1 text-[var(--color-teal)] font-bold"><Ic n="copy" s={14} />copiar</button>
          </div>
          <div className="max-h-[42vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
            {found.slice(0, 400).map((u, i) => (
              <a key={u.pk} href={`https://instagram.com/${u.username}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5">
                <span className="w-6 text-[11px] text-[#4a5a6d] text-right">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-[13px]">@{u.username}{u.full ? <span className="text-[var(--color-slate)] text-[12px]"> · {u.full}</span> : null}</span>
                {u.verif && <span className="text-[var(--color-teal)]"><Ic n="badge" s={13} /></span>}
                {u.priv && <span className="text-[var(--color-slate)]"><Ic n="lock" s={13} /></span>}
                <span className="text-[var(--color-steel)]"><Ic n="external" s={14} /></span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
