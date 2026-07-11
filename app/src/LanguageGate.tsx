// Tela de seleção de idioma na 1ª abertura (regra do Manual). Escolha ANTES de abrir o app.
// Persiste em localStorage (via i18n) + trocador fica no Config.
import { LANGS, useI18n, type Lang } from "./i18n";
import { Logo } from "./Logo";

export default function LanguageGate() {
  const { setLang, t } = useI18n();
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden text-[var(--color-paper)]">
      <div className="aurora" />
      <div className="relative z-10 w-full max-w-sm px-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo s={72} />
          <div>
            <div className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-[#00e5c9] via-[#7ef7e6] to-[#00e5c9] bg-clip-text text-transparent">
              Codex IG
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-slate)]">growth suite</div>
          </div>
        </div>

        <div className="mt-8 mb-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-slate)]">
          {t("gate.header")}
        </div>

        <div className="space-y-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code as Lang)}
              className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-left text-[15px] font-bold transition hover:border-[var(--color-teal)] hover:bg-white/5 active:scale-[.99]"
            >
              {l.native}
            </button>
          ))}
        </div>

        <div className="mt-5 text-[11px] text-[var(--color-slate)]">{t("gate.hint")}</div>
      </div>
    </div>
  );
}
