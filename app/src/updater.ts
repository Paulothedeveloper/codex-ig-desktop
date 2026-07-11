// Auto-update via GitHub Release (assinado). Checa no boot; se houver, pergunta e instala.
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkUpdate(t: (k: string, v?: Record<string, string | number>) => string) {
  try {
    const update = await check();
    if (update) {
      if (confirm(t("update.prompt", { v: update.version }))) {
        await update.downloadAndInstall();
        await relaunch();
      }
    }
  } catch (e) {
    // sem release/endpoint ainda ou offline — silencioso, não atrapalha o app
    console.warn("update check:", e);
  }
}
