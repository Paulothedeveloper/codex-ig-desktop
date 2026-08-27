import { useMemo } from "react";
import { useI18n } from "./i18n";
import { scoreCaption } from "./captionScore";

// Painel de "Nota da Legenda" — determinístico (metodo CoSchedule + EMV), zero IA.
// Reusado na aba Nota e pra pontuar cada legenda que a IA sugere.
const GRADE_COLOR: Record<string, string> = {
  A: "#00e5c9",
  B: "#7ef7e6",
  C: "#ffd166",
  D: "#ff6b5c",
};
const barColor = (s: number) => (s >= 0.75 ? "#00e5c9" : s >= 0.45 ? "#ffd166" : "#ff6b5c");

export default function CaptionScorePanel({ text, compact = false }: { text: string; compact?: boolean }) {
  const { t } = useI18n();
  const r = useMemo(() => scoreCaption(text), [text]);
  if (!text.trim()) return null;
  const gc = GRADE_COLOR[r.grade];

  return (
    <div className={"pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] " + (compact ? "p-4" : "p-5")}>
      {/* cabeçalho: nota + grade + EMV */}
      <div className="flex items-center gap-4">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: gc }}>
          <span className="text-[22px] font-black leading-none" style={{ color: gc }}>{r.total}</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-[var(--color-paper)]">{t("score.title")}</span>
            <span className="rounded-md px-2 py-0.5 text-[12px] font-black" style={{ background: gc + "22", color: gc }}>{r.grade}</span>
          </div>
          <div className="text-[12px] text-[var(--color-slate)]">{t("score.gradeNote." + r.grade)}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-slate)]">
            <span>{r.words} {t("score.words")}</span>
            <span>{r.chars} {t("score.chars")}</span>
            <span>{r.hashtags} hashtags</span>
            <span style={{ color: r.emvPct >= 30 ? "#00e5c9" : undefined }}>EMV {r.emvPct}% {r.emvClass !== "none" && "· " + t("score.emvClass." + r.emvClass)}</span>
          </div>
        </div>
      </div>

      {/* barras por componente */}
      <div className="mt-4 space-y-2">
        {r.components.map((c) => (
          <div key={c.key} className="flex items-center gap-3">
            <span className="w-[128px] shrink-0 text-right text-[12px] text-[var(--color-ink)]">{t("score.c." + c.key)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#0a0f18]">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: Math.round(c.score * 100) + "%", background: barColor(c.score) }} />
            </div>
            <span className="w-[86px] shrink-0 text-[11px] text-[var(--color-slate)]">{c.value}</span>
          </div>
        ))}
      </div>

      {/* correções priorizadas */}
      {r.fixes.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--color-steel)] bg-[#0e1522] p-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-teal2)]">{t("score.fixesTitle")}</div>
          <ul className="space-y-1">
            {r.fixes.map((f, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-[var(--color-ink)]">
                <span className="text-[var(--color-teal)]">→</span>
                <span>{t("score.d." + f)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
