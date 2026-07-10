import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const WL_KEY = "codexig_whitelist";

export default function Config() {
  const [uid, setUid] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wl, setWl] = useState<string[]>(JSON.parse(localStorage.getItem(WL_KEY) || "[]"));

  async function check() {
    setChecking(true);
    try { setUid(await invoke<string>("ig_session_ok")); } catch { setUid(null); } finally { setChecking(false); }
  }
  useEffect(() => { check(); }, []);

  function clearWl() {
    if (!confirm("Limpar a whitelist? As contas protegidas voltam a aparecer na limpeza.")) return;
    localStorage.setItem(WL_KEY, "[]"); setWl([]);
  }
  function exportWl() {
    const csv = "pk\n" + wl.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "codexig-whitelist.csv"; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">Conta do Instagram</div>
        {checking && <div className="text-[13px] text-[var(--color-slate)]">Verificando sessão…</div>}
        {!checking && uid && <div className="text-[14px]">Conectado · <b className="text-[var(--color-teal)]">uid {uid}</b> <span className="text-[var(--color-slate)] text-[12px]">(sessão lida em runtime, nunca gravada)</span></div>}
        {!checking && !uid && (
          <div className="text-[13px] text-[var(--color-slate)]">
            Sem sessão. Faça login na janela <b className="text-[var(--color-paper)]">Codex IG — Instagram</b> e clique{" "}
            <button onClick={check} className="text-[var(--color-teal)] font-bold underline">verificar de novo</button>.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--color-slate)] mb-3">Whitelist (protegidos da limpeza)</div>
        <div className="text-[14px]"><b className="text-[var(--color-teal2)]">{wl.length}</b> conta(s) protegida(s)</div>
        <div className="mt-3 flex gap-3">
          <button onClick={exportWl} disabled={!wl.length} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-paper)] disabled:opacity-40">Exportar CSV</button>
          <button onClick={clearWl} disabled={!wl.length} className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[#43221d] text-[var(--color-coral2)] disabled:opacity-40">Limpar whitelist</button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 text-[13px] text-[var(--color-slate)] leading-relaxed">
        <div className="text-[11px] uppercase tracking-widest mb-2">Privacidade</div>
        Tudo roda <b className="text-[var(--color-paper)]">local</b>, na tua sessão. Os cookies do Instagram são lidos em tempo de execução e <b className="text-[var(--color-paper)]">nunca gravados</b> por nós. Dados ficam no teu aparelho (SQLite). As chaves do tracker ficam no navegador do app. Sem servidor de terceiro, sem PII.
      </div>
    </div>
  );
}
