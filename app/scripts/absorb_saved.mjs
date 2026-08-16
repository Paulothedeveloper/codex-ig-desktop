// Motor de absorção automática (VISÃO) — disparado pelo Codex IG (botão "Absorver").
// últimos N salvos -> yt-dlp+ffmpeg (só frames) -> Gemini 2.5-flash lê os frames -> receita -> dedup -> roteia -> grava .md.
// Rodado por: node absorb_saved.mjs <N>   (o Rust embute este arquivo e chama o node).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOME = os.homedir();
const PY = `${HOME}/AppData/Local/Programs/Python/Python312/python.exe`;
const SK = `${HOME}/.claude/skills/transcribe-video-url/transcribe.py`;
const VAULTS = "G:/Meu Drive/VAULTS";
const REELS = `${VAULTS}/WINDOWS - DAVINCI RESOLVE/7 - REELS (biblioteca)`;
const STATE = `${VAULTS}/_INBOX-SALVOS/_FILA-ESTADO.json`;
const WORK = path.join(os.tmpdir(), "codexig-absorb");
const TMP = path.join(WORK, "tmp");
const LOG = path.join(WORK, "absorb.log");
fs.mkdirSync(TMP, { recursive: true });

function readKey(p) { try { const t = fs.readFileSync(p, "utf8"); const m = t.match(/AIza[0-9A-Za-z_\-]{30,}/); return m ? m[0] : t.trim().split(/\s+/).pop(); } catch { return null; } }
const GKEY = readKey(`${HOME}/Documents/API KEY CLAUDE CODE/chave api paga google.txt`);

const N = parseInt(process.argv[2] || "100", 10);
const log = (m) => { try { fs.appendFileSync(LOG, m + "\n"); } catch {} console.log(m); };

const FAM = {
  COLOR: { note: "99h 🎨 - Receitas dos Salvos — COLOR" },
  EDICAO: { note: "99i ✂️ - Receitas dos Salvos — EDIÇÃO" },
  FUSION: { note: "99j 🧩 - Receitas dos Salvos — FUSION" },
  AUDIO: { note: "99k 🔊 - Receitas dos Salvos — ÁUDIO" },
  LEGENDA: { note: "99l 🔤 - Receitas dos Salvos — LEGENDA" },
  PLUGIN: { note: "99m 🔌 - Receitas dos Salvos — PLUGIN" },
};
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
function ensureNote(fam) {
  const p = `${REELS}/${fam.note}.md`;
  if (!fs.existsSync(p)) fs.writeFileSync(p, `---\ntipo: receitas\ntags: [reels, salvos, receita, davinci]\norigem: _INBOX-SALVOS\n---\n\n# ${fam.note.replace(/^[0-9a-z]+ /i, "")}\n\n> [!info] Receitas automáticas dos reels salvos no IG (Codex IG -> visão IA).\n\n`);
  return p;
}
function existingTitles(p) {
  if (!fs.existsSync(p)) return new Set();
  return new Set(fs.readFileSync(p, "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => norm(l.slice(3))));
}
function getFrames(url, out) {
  const r = spawnSync(PY, [SK, url, "--frames", "8", "--no-transcribe", "--out", out], { encoding: "utf8", timeout: 180000 });
  const fd = `${out}/frames`;
  return fs.existsSync(fd) ? fs.readdirSync(fd).filter((f) => f.endsWith(".jpg")).map((f) => `${fd}/${f}`) : [];
}
async function gemini(caption, framePaths) {
  const parts = [{ text: `Você é colorista/editor sênior de DaVinci Resolve. Os frames são de um reel-tutorial (tela mostrando os passos). LEGENDA: "${caption}". Extraia a TÉCNICA e escreva receita passo a passo em PT-BR simples. Menu/botão em português com o inglês entre parênteses; nós do Fusion em inglês; use "Grade" (não "Grid"). Se for só promo/venda/pessoal/sem técnica clara, keep=false. Responda SÓ JSON: {"keep":bool,"tema":"COLOR|EDICAO|FUSION|AUDIO|LEGENDA|PLUGIN","titulo":"curto","sacada":"1 frase","passos":["..."],"cuidado":""}` }];
  for (const fp of framePaths.slice(0, 8)) parts.push({ inline_data: { mime_type: "image/jpeg", data: fs.readFileSync(fp).toString("base64") } });
  const body = { contents: [{ parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } };
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GKEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status === 503) { await new Promise((s) => setTimeout(s, 12000)); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    return JSON.parse(j.candidates[0].content.parts[0].text);
  }
  throw new Error("gemini 429/503");
}

const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
const codes = Object.keys(st.items).slice(0, N);
log(`\n=== ABSORB ${new Date().toISOString()} — top ${N} ===`);
let done = 0, skip = 0, fail = 0, dup = 0, consec = 0;
const titleCache = {};
for (const code of codes) {
  const it = st.items[code];
  if (it.receita && it.n !== "(skip)") continue;
  const url = `https://www.instagram.com/p/${code}/`;
  const out = `${TMP}/${code}`;
  fs.mkdirSync(out, { recursive: true });
  const frames = getFrames(url, out);
  if (!frames.length) { fail++; consec++; log(`[fail] ${code}`); if (consec >= 4) { log("... 4 falhas seguidas: pausa 10min (block do IG?)"); await new Promise((s) => setTimeout(s, 600000)); consec = 0; } continue; }
  consec = 0;
  let rec;
  try { rec = await gemini(it.c || "", frames); } catch (e) { fail++; log(`[fail-ia] ${code} ${e.message}`); try { fs.rmSync(out, { recursive: true, force: true }); } catch {} continue; }
  try { fs.rmSync(out, { recursive: true, force: true }); } catch {}
  if (!rec.keep) { it.receita = true; it.n = "(skip)"; skip++; log(`[skip] ${code} — ${rec.titulo || ""}`); fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  const tema = String(rec.tema || "").split(/[|,/]/)[0].trim().toUpperCase(); // Gemini às vezes junta temas
  const fam = FAM[tema] || FAM.COLOR;
  rec.tema = tema;
  const p = ensureNote(fam);
  titleCache[rec.tema] = titleCache[rec.tema] || existingTitles(p);
  if (titleCache[rec.tema].has(norm(rec.titulo))) { it.receita = true; it.n = fam.note; dup++; log(`[dup] ${code} — ${rec.titulo}`); fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  titleCache[rec.tema].add(norm(rec.titulo));
  const passos = (rec.passos || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
  fs.appendFileSync(p, `## ${rec.titulo}\n*Reel: [abrir](${url})*\n\n> [!tip] ${rec.sacada || ""}\n\n${passos}\n${rec.cuidado ? `\n> [!warning] ${rec.cuidado}\n` : ""}\n---\n\n`);
  it.receita = true; it.n = fam.note; done++;
  log(`[ok:${rec.tema}] ${code} — ${rec.titulo}`);
  fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
  await new Promise((s) => setTimeout(s, 1500));
}
fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
log(`=== FIM: ok ${done} · skip ${skip} · dup ${dup} · fail ${fail} ===`);
