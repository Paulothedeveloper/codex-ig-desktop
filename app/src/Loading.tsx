// Loading "ao vivo" pras ferramentas que demoram (busca/IA): spinner branded +
// frases de status que ciclam (sensação de processo) + skeleton opcional.
import { useEffect, useState } from "react";

export default function Loading({ label, steps, skeleton = 3 }: { label?: string; steps?: string[]; skeleton?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!steps || steps.length < 2) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % steps.length), 1600);
    return () => window.clearInterval(id);
  }, [steps]);
  const msg = steps && steps.length ? steps[i] : label;
  return (
    <div className="pop rounded-2xl border border-[var(--color-teal)]/30 bg-[var(--color-panel)] p-5">
      <div className="flex items-center gap-3">
        <span className="inline-block h-5 w-5 shrink-0 rounded-full border-2 border-[var(--color-steel)] border-t-[var(--color-teal)] spin" />
        <span className="text-[13px] font-bold text-[var(--color-teal2)]">
          {msg}<span className="dots"><span>.</span><span>.</span><span>.</span></span>
        </span>
      </div>
      {skeleton > 0 && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: skeleton }).map((_, k) => <div key={k} className="skel h-4" style={{ width: `${92 - k * 12}%` }} />)}
        </div>
      )}
    </div>
  );
}
