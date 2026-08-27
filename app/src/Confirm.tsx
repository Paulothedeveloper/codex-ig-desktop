// Modal de confirmação custom (substitui window.confirm nativo — popup do SO não estiliza,
// mesma regra do <select>). Promise-based: `if (!(await confirm({body}))) return;`. Esc/click-fora = cancela.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import AnimatedOverlay from "./AnimatedOverlay";

type Opts = { body: string; danger?: boolean };
const Ctx = createContext<(o: Opts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<Opts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = (o: Opts) =>
    new Promise<boolean>((res) => { resolver.current = res; setOpts(o); });
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [opts]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <AnimatedOverlay data={opts} onClose={() => close(false)} z={60} className="bg-black/60">
        {(o) => (
          <div className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]" role="dialog" aria-modal="true">
            <div className="text-[14px] text-[var(--color-paper)] leading-relaxed">{o.body}</div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-xl px-4 py-2 text-[13px] font-bold bg-[#0e1522] border border-[var(--color-steel)] text-[var(--color-slate)] hover:text-[var(--color-paper)]"
              >
                {t("confirm.cancel")}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className={
                  "rounded-xl px-4 py-2 text-[13px] font-bold hover:brightness-110 " +
                  (o.danger
                    ? "bg-[linear-gradient(135deg,#ff4d3d,#e0392b)] text-white"
                    : "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]")
                }
              >
                {t("confirm.ok")}
              </button>
            </div>
          </div>
        )}
      </AnimatedOverlay>
    </Ctx.Provider>
  );
}
