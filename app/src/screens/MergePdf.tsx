import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { parsePdfBytes, mergeDedupeSort, type Person } from "../pdfparse";

export default function MergePdf() {
  const { t, nf } = useI18n();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState("");
  const [list, setList] = useState<Person[] | null>(null);
  const [err, setErr] = useState("");

  async function pick() {
    setErr("");
    const paths = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!paths) return;
    const arr = Array.isArray(paths) ? paths : [paths];
    if (!arr.length) return;
    setBusy(true);
    setList(null);
    const all: Person[] = [];
    try {
      for (let i = 0; i < arr.length; i++) {
        setProg(t("merge.reading", { i: i + 1, n: arr.length }));
        const bytes = new Uint8Array(await invoke<number[]>("read_bytes", { path: arr[i] }));
        all.push(...(await parsePdfBytes(bytes)));
      }
      setList(mergeDedupeSort(all));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      setProg("");
    }
  }

  async function exportCsv() {
    if (!list) return;
    const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    let csv = "﻿Nome,Instagram\r\n";
    for (const p of list) csv += `${esc(p.name)},${p.handle}\r\n`;
    const path = await save({ defaultPath: "lista-alfabetica.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    await invoke("write_bytes", { path, bytes: Array.from(new TextEncoder().encode(csv)) });
  }

  async function copy() {
    if (!list) return;
    const txt = list.map((p) => `${p.name || t("merge.noName")} — ${p.handle}`).join("\n");
    await navigator.clipboard.writeText(txt);
  }

  return (
    <details className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
      <summary className="cursor-pointer text-[13px] font-bold text-[var(--color-teal2)]">{t("merge.title")}</summary>
      <p className="mt-2 text-[12px] leading-snug text-[var(--color-slate)]">{t("merge.hint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={pick} disabled={busy} className="rounded-lg bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-3.5 py-2 text-[12.5px] font-bold text-[#04120f] disabled:opacity-40">
          {busy ? prog || t("merge.picking") : t("merge.pick")}
        </button>
        {list && (
          <>
            <button onClick={exportCsv} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] font-bold text-[var(--color-paper)]">{t("merge.exportCsv")}</button>
            <button onClick={copy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3.5 py-2 text-[12.5px] text-[var(--color-paper)]">{t("merge.copy")}</button>
            <span className="text-[12px] text-[var(--color-slate)]">{t("merge.total", { n: nf(list.length) })}</span>
          </>
        )}
      </div>
      {err && <p className="mt-2 text-[12px] text-[var(--color-coral2)]">{err}</p>}
      {list && (
        <div className="selectable stagger mt-3 max-h-[46vh] overflow-auto rounded-xl border border-[var(--color-line)] bg-[#090d15] p-1.5">
          {list.length === 0 ? (
            <p className="p-3 text-[13px] text-[var(--color-slate)]">{t("merge.none")}</p>
          ) : (
            list.map((p, i) => (
              <a
                key={p.handle}
                href={`https://instagram.com/${p.handle.replace("@", "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
              >
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-[var(--color-slate)]">{i + 1}</span>
                <span className="truncate text-[13px] pii">{p.name || t("merge.noName")}</span>
                <span className="shrink-0 text-[12px] text-[var(--color-teal2)] pii">{p.handle}</span>
              </a>
            ))
          )}
        </div>
      )}
    </details>
  );
}
