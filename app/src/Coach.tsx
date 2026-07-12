// Onboarding = coachmarks CONTEXTUAIS (regra do Manual: aponta o elemento real, NÃO slideshow).
// Destaca cada aba da sidebar em sequência, troca pra aba enquanto explica, pula/persiste.
import { useEffect, useLayoutEffect, useState } from "react";
import { useI18n } from "./i18n";

const ONB = "codexig_onboarded";
export const isOnboarded = () => localStorage.getItem(ONB) === "1";

type Step = { id: string; target: string };
const STEPS: Step[] = [
  { id: "instagram", target: "nav-instagram" },
  { id: "report", target: "nav-report" },
  { id: "clicks", target: "nav-clicks" },
  { id: "config", target: "nav-config" },
];

export default function Coach({ onStep, onClose }: { onStep: (tab: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];

  // troca a aba destacada ao avançar (contexto real)
  useEffect(() => { onStep(step.id); }, [i]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.getElementById(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = window.setTimeout(measure, 60); // após a troca de aba/layout
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [i]);

  function finish() { localStorage.setItem(ONB, "1"); onClose(); }
  const last = i === STEPS.length - 1;

  const ring = rect
    ? { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }
    : null;
  // tooltip à direita do alvo (a sidebar fica à esquerda)
  const card = rect ? { top: Math.max(12, rect.top - 4), left: rect.right + 16 } : { top: 80, left: 260 };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={finish} />
      {ring && (
        <div
          className="absolute rounded-2xl border-2 border-[var(--color-teal)] pointer-events-none transition-all"
          style={{ ...ring, boxShadow: "0 0 0 9999px rgba(0,0,0,0)" as any, outline: "9999px solid rgba(7,11,18,.62)" }}
        />
      )}
      <div
        className="absolute w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,.9)]"
        style={card}
      >
        <div className="text-[13px] font-bold text-[var(--color-teal)]">{t("coach." + step.id + ".t")}</div>
        <div className="mt-1 text-[13px] text-[var(--color-slate)] leading-relaxed">{t("coach." + step.id + ".b")}</div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-[var(--color-slate)]">{t("coach.step", { i: i + 1, n: STEPS.length })}</span>
          <div className="flex items-center gap-3">
            {!last && <button onClick={finish} className="text-[12px] text-[var(--color-slate)] hover:text-[var(--color-paper)]">{t("coach.skip")}</button>}
            <button
              onClick={() => (last ? finish() : setI(i + 1))}
              className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110"
            >
              {last ? t("coach.done") : t("coach.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
