// Auto-update via GitHub Release (assinado). Checa no boot e mostra POPUP in-app
// (não native confirm). Config pode disparar checagem manual pelo evento.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const UPDATE_EVENT = "codexig:update-available";
export const COACH_EVENT = "codexig:open-coach";

// Retorna o Update se houver (sem efeito colateral). null = já atualizado / offline.
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch (e) {
    console.warn("update check:", e);
    return null;
  }
}

// Baixa, instala e reinicia.
export async function runUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

// Boot: checa e, se houver, avisa o App via evento (popup).
export async function checkUpdateOnBoot(): Promise<void> {
  const u = await checkForUpdate();
  if (u) window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: u }));
}
