import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "./i18n";

/** Sem sessao (o backend nao achou ds_user_id) — precisa logar. */
export function isLoginErr(e: unknown): boolean {
  return String(e).includes("require_login");
}
/** IG limitou/bloqueou temporario ("aguarde alguns minutos") — NAO e logout, e throttle. */
export function isRateErr(e: unknown): boolean {
  return String(e).includes("ig_rate_limited");
}

/** Bloco de erro amigavel: throttle do IG (espere), sessao caida (logue), ou erro cru traduzido. */
export default function SessionError({
  err,
  onRetry,
  failedKey,
}: {
  err: string;
  onRetry: () => void;
  failedKey: string;
}) {
  const { t } = useI18n();
  const box = "rounded-2xl border border-[#43221d] bg-[#1a0f0d] p-4 text-[13px] text-[var(--color-coral2)]";
  const rate = isRateErr(err);
  const login = isLoginErr(err);
  if (rate || login)
    return (
      <div className={box}>
        {rate ? t("err.rate") : t("err.session", { win: t("win.name") })}
        <div className="mt-3 flex gap-2">
          {login && (
            <button
              onClick={() => invoke("focus_ig").catch(() => {})}
              className="rounded-lg px-3 py-1.5 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110"
            >
              {t("config.openIg")}
            </button>
          )}
          <button onClick={onRetry} className="underline">
            {t("report.retry")}
          </button>
        </div>
      </div>
    );
  return (
    <div className={box}>
      {t(failedKey, { e: err })}
      <button onClick={onRetry} className="ml-3 underline">
        {t("report.retry")}
      </button>
    </div>
  );
}
