import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "./i18n";

/** true quando o backend sinalizou sessao invalida/deslogada (sentinela do Rust). */
export function isLoginErr(e: unknown): boolean {
  return String(e).includes("require_login");
}

/** Bloco de erro: se for sessao caida, mostra "faca login" + botao que abre/foca a janela IG;
 *  senao, o erro cru traduzido. Usado por Relatorio, Limpar e Alvos. */
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
  if (isLoginErr(err))
    return (
      <div className={box}>
        {t("err.session", { win: t("win.name") })}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => invoke("focus_ig").catch(() => {})}
            className="rounded-lg px-3 py-1.5 font-bold text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] hover:brightness-110"
          >
            {t("config.openIg")}
          </button>
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
