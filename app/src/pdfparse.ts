// Lê PDFs (os próprios relatórios do Codex IG ou de fora) e extrai Nome + @ de curtidas/comentários.
// Mesma lógica provada no scratchpad: agrupa por linha, acha coluna "Nome" pelo cabeçalho,
// separa @ do nome pela posição X, reconstrói glifos por gap e limpa lixo de emoji.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Person = { handle: string; name: string };

const isHandle = (s: string) => /^@[A-Za-z0-9._]+$/.test(s);
// só o que nome PT-BR usa (Ø/Ý/þ/€ = emoji quebrado, fora)
const cleanName = (s: string) =>
  s.replace(/[^ A-Za-z0-9.'|_\-àáâãçéêíóôõúüÀÁÂÃÇÉÊÍÓÔÕÚÜ]/g, "").replace(/\s+/g, " ").trim();

export async function parsePdfBytes(bytes: Uint8Array): Promise<Person[]> {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const out: Person[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, { s: string; x: number; w: number }[]>();
    for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
      const s = it.str || "";
      if (!s.trim()) continue;
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ s, x, w: it.width || 0 });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    let nameX: number | null = null;
    let nextX = Infinity;
    for (const y of ys) {
      const items = rows.get(y)!.sort((a, b) => a.x - b.x);
      const joined = items.map((i) => i.s).join(" ");
      if (/Usu[aá]rio/.test(joined) && /Nome/.test(joined)) {
        const nomeIt = items.find((i) => /^Nome/.test(i.s));
        const afterIt = items.find((i) => /Data\/hora|Coment/.test(i.s));
        nameX = nomeIt ? nomeIt.x : null;
        nextX = afterIt ? afterIt.x : Infinity;
        continue;
      }
      const h = items.find((i) => isHandle(i.s.trim()));
      if (!h || nameX == null) continue;
      const toks = items
        .filter((i) => i.x >= nameX! - 4 && i.x < nextX && !isHandle(i.s.trim()) && !/^\(verif/.test(i.s.trim()) && !/^\d+$/.test(i.s.trim()))
        .sort((a, b) => a.x - b.x);
      let name = "";
      let prevRight: number | null = null;
      for (const it of toks) {
        if (prevRight != null && it.x - prevRight > 1.2) name += " ";
        name += it.s;
        prevRight = it.x + it.w;
      }
      name = cleanName(name);
      if (name === "-" || name === "." || name === "|") name = "";
      out.push({ handle: h.s.trim(), name });
    }
  }
  return out;
}

/** Junta várias listas, remove repetição por @, ordena alfabético por nome (fallback @). */
export function mergeDedupeSort(all: Person[]): Person[] {
  const map = new Map<string, Person>();
  for (const p of all) {
    if (!p.handle) continue;
    const key = p.handle.toLowerCase();
    const cur = map.get(key);
    if (!cur) map.set(key, { handle: p.handle, name: p.name });
    else if (p.name && p.name.length > cur.name.length) cur.name = p.name;
  }
  return [...map.values()].sort((a, b) =>
    (a.name || a.handle).toLowerCase().localeCompare((b.name || b.handle).toLowerCase(), "pt-BR"),
  );
}
