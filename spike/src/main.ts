import { invoke } from "@tauri-apps/api/core";

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector<HTMLButtonElement>("#run");
  const out = document.querySelector<HTMLElement>("#out");
  btn?.addEventListener("click", async () => {
    if (!out) return;
    out.className = "";
    out.textContent = "lendo cookie + chamando a API...";
    btn.disabled = true;
    try {
      const res = await invoke<string>("spike_following_count");
      out.className = "ok";
      out.textContent = res;
    } catch (e) {
      out.className = "err";
      out.textContent = "FALHOU: " + String(e);
    } finally {
      btn.disabled = false;
    }
  });
});
