// Motor de absorção UNIFICADO (Codex IG): salvos -> receita detalhada no vault CERTO.
// vídeo -> frames (yt-dlp) | foto/carrossel -> imagens (gallery-dl, anexa no vault).
// Gemini 2.5-flash decide TEMA -> rota determinística (1 assunto = 1 vault; reusa ou cria) -> dedup.
// Args: argv[2] = "codes:c1,c2,.." OU número N (últimos N) OU vazio (=100).
//       argv[3] = "vault:<Nome>" (destino forçado pelo usuário) OU vazio (auto = IA decide).
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOME = os.homedir();
const PY = `${HOME}/AppData/Local/Programs/Python/Python312/python.exe`;
const SK = `${HOME}/.claude/skills/transcribe-video-url/transcribe.py`;
const VAULTS = "G:/Meu Drive/VAULTS";
const DV = `${VAULTS}/WINDOWS - DAVINCI RESOLVE/7 - REELS (biblioteca)`;
const STATE = `${VAULTS}/_INBOX-SALVOS/_FILA-ESTADO.json`;
const TMP = `${os.tmpdir()}/codexig-absorb/tmp`;
const LOG = `${os.tmpdir()}/codexig-absorb/absorb.log`;
fs.mkdirSync(TMP, { recursive: true });
const log = (m) => { try { fs.appendFileSync(LOG, m + "\n"); } catch {} console.log(m); };

function readKey(p) { try { const t = fs.readFileSync(p, "utf8"); const m = t.match(/AIza[0-9A-Za-z_\-]{30,}/); return m ? m[0] : t.trim().split(/\s+/).pop(); } catch { return null; } }
const GKEY = readKey(`${HOME}/Documents/API KEY CLAUDE CODE/chave api paga google.txt`);

// destino forçado pelo usuário (argv[3] = "vault:<Nome>"); vazio = auto (IA decide).
const destArg = (process.argv[3] || "").trim();
const FORCED = destArg.startsWith("vault:") ? destArg.slice(6).trim() : null;

// ---- ROTA INTELIGENTE: tema -> {vault, dir, note}. Determinística = 1 assunto sempre no mesmo lugar.
function route(tema, subtema, titulo) {
  // usuário escolheu um vault fixo -> tudo cai lá, numa nota só.
  if (FORCED) return { vault: FORCED, dir: `${VAULTS}/${FORCED}`, note: "Receitas dos Salvos" };
  const t = `${tema || ""} ${subtema || ""} ${titulo || ""}`.toLowerCase();
  // DaVinci = guarda-chuva de TODO audiovisual (pós + produção/câmera/foto/luz/composição)
  const davinci = /davinci|resolve|\bcor\b|color|grad|\blut\b|dctl|edic|\bedit|corte|transi|fusion|\bvfx\b|motion|keyframe|\baudio\b|\bsom\b|fairlight|legenda|caption|subtitle|plugin|premiere|after ?effects|capcut|filmmak|cinematic|c[aâ]mera|fotograf|\bfoto\b|ilumina|\bluz\b|composi[çc]|enquadr|\blente\b|exposi[çc]|slow ?motion|\bvideo\b|v[ií]deo|reel|storytell|roteir|gravar|captac|produ[çc][aã]o audiovisual/;
  if (davinci.test(t)) {
    let note = "99i ✂️ - Receitas dos Salvos — EDIÇÃO"; // default edição
    if (/\bcor\b|color|grad|\blut\b|dctl|tonal|cinematic|colorist/.test(t)) note = "99h 🎨 - Receitas dos Salvos — COLOR";
    else if (/fusion|\bvfx\b|\b3d\b|track|composit|magic ?mask/.test(t)) note = "99j 🧩 - Receitas dos Salvos — FUSION";
    else if (/\baudio\b|\bsom\b|music|fairlight|\bvoz\b|sfx/.test(t)) note = "99k 🔊 - Receitas dos Salvos — ÁUDIO";
    else if (/legenda|caption|subtitle|texto na tela/.test(t)) note = "99l 🔤 - Receitas dos Salvos — LEGENDA";
    else if (/plugin|preset|template|after ?effects|capcut/.test(t)) note = "99m 🔌 - Receitas dos Salvos — PLUGIN";
    else if (/c[aâ]mera|fotograf|\bfoto\b|ilumina|\bluz\b|composi[çc]|enquadr|\blente\b|exposi[çc]|gravar|captac|slow ?motion/.test(t)) note = "99n 🎥 - Receitas dos Salvos — PRODUÇÃO & CÂMERA";
    return { vault: "WINDOWS - DAVINCI RESOLVE", dir: DV, note };
  }
  if (/concurso|edital|estudo|prova|questao|questão|oab|cespe|vunesp/.test(t))
    return { vault: "ESTUDOS - CONCURSO", dir: `${VAULTS}/ESTUDOS - CONCURSO`, note: "Estudo — receitas dos Salvos" };
  if (/\bia\b|intelig|automa|prompt|chatgpt|\bgpt\b|claude|midjourney|runway|gemini|agente|n8n/.test(t))
    return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "IA & Automação — receitas dos Salvos" };
  // tema novo -> nota própria no guarda-chuva IDEIAS SALVAS (cria; anti-explosão de vault)
  const clean = (tema || "outros").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim().slice(0, 24) || "outros";
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: `${title} — receitas dos Salvos` };
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
function ensureNote(dir, note) {
  fs.mkdirSync(dir, { recursive: true });
  const p = `${dir}/${note}.md`;
  if (!fs.existsSync(p)) fs.writeFileSync(p, `---\ntipo: receitas\ntags: [salvos, receita]\norigem: _INBOX-SALVOS\n---\n\n# ${note.replace(/^[0-9a-z]+ /i, "")}\n\n> [!info] Notas detalhadas dos reels salvos (Codex IG → IA de visão).\n\n`);
  return p;
}
function titlesOf(p) { if (!fs.existsSync(p)) return new Set(); return new Set(fs.readFileSync(p, "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => norm(l.slice(3).replace(/📎/g, "")))); }

// vídeo -> frames; senão foto/carrossel -> imagens
function getMedia(url, out) {
  spawnSync(PY, [SK, url, "--frames", "8", "--no-transcribe", "--out", out], { encoding: "utf8", timeout: 180000 });
  const fd = `${out}/frames`;
  let paths = fs.existsSync(fd) ? fs.readdirSync(fd).filter((f) => f.endsWith(".jpg")).map((f) => `${fd}/${f}`) : [];
  if (paths.length) return { paths, isPhoto: false };
  const id = `${out}/imgs`; fs.mkdirSync(id, { recursive: true });
  spawnSync(PY, ["-m", "gallery_dl", "--cookies-from-browser", "firefox", "-D", id, url], { encoding: "utf8", timeout: 180000 });
  paths = fs.existsSync(id) ? fs.readdirSync(id).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).map((f) => `${id}/${f}`) : [];
  return { paths, isPhoto: true };
}

async function gemini(caption, paths, isPhoto) {
  const extra = isPhoto ? "É FOTO/CARROSSEL (ex.: edital, infográfico) — LEIA o texto das imagens e resuma o conteúdo real." : "É um reel-tutorial (tela mostrando os passos).";
  const sys = `Você é especialista multi-área (DaVinci Resolve, concurso, IA/automação, design, negócio). ${extra} A partir dos frames + legenda, decida o TEMA e escreva uma nota detalhada PT-BR simples (passo a passo / pontos-chave). Menu de software em português (inglês entre parênteses); nós do Fusion em inglês. Se for só promo/venda/pessoal sem conteúdo útil, keep=false.
Responda SÓ JSON: {"keep":bool,"tema":"davinci|concurso|ia|design|negocio|marketing|financas|<outro-slug>","subtema":"(se davinci: color|edicao|fusion|audio|legenda|plugin)","titulo":"curto","sacada":"1 frase","passos":["..."],"cuidado":""}
LEGENDA: "${caption}"`;
  const parts = [{ text: sys }];
  for (const fp of paths.slice(0, 8)) parts.push({ inline_data: { mime_type: "image/jpeg", data: fs.readFileSync(fp).toString("base64") } });
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

// ---- seleção de itens ----
const arg = (process.argv[2] || "100").trim();
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
let codes;
if (arg.startsWith("codes:")) codes = arg.slice(6).split(",").map((s) => s.trim()).filter(Boolean);
else codes = Object.keys(st.items).slice(0, parseInt(arg, 10) || 100);

log(`\n=== ABSORB ${new Date().toISOString()} — ${codes.length} itens (${arg.startsWith("codes:") ? "selecionados" : "top " + arg}) → ${FORCED ? "vault: " + FORCED : "auto (IA decide)"} ===`);
let done = 0, skip = 0, fail = 0, dup = 0;
const titleCache = {};
for (const code of codes) {
  const it = st.items[code] || (st.items[code] = { s: "queued", c: "" });
  if (it.detalhe || it.receita) { continue; } // já virou nota (motor novo=detalhe, antigo=receita)
  const url = `https://www.instagram.com/p/${code}/`;
  const out = `${TMP}/${code}`; fs.mkdirSync(out, { recursive: true });
  const { paths, isPhoto } = getMedia(url, out);
  if (!paths.length) { it.detalhe = true; it.n = "(sem mídia)"; skip++; log(`[skip] ${code} (sem vídeo/foto)`); try { fs.rmSync(out, { recursive: true, force: true }); } catch {} fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  let rec;
  try { rec = await gemini(it.c || "", paths, isPhoto); } catch (e) { fail++; log(`[fail] ${code} ${e.message}`); try { fs.rmSync(out, { recursive: true, force: true }); } catch {} continue; }
  if (!rec.keep) { it.detalhe = true; it.n = "(skip)"; skip++; log(`[skip] ${code} — ${rec.titulo || "sem técnica"}`); try { fs.rmSync(out, { recursive: true, force: true }); } catch {} fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  const rt = route(rec.tema, rec.subtema, rec.titulo);
  const notePath = ensureNote(rt.dir, rt.note);
  titleCache[notePath] = titleCache[notePath] || titlesOf(notePath);
  if (titleCache[notePath].has(norm(rec.titulo))) { it.detalhe = true; it.n = rt.note; it.vault = rt.vault; dup++; log(`[dup] ${code} — ${rec.titulo}`); try { fs.rmSync(out, { recursive: true, force: true }); } catch {} fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  titleCache[notePath].add(norm(rec.titulo));
  // foto: anexa até 3 imagens no vault destino
  let embed = "";
  if (isPhoto) {
    const anex = `${rt.dir}/_anexos`; fs.mkdirSync(anex, { recursive: true });
    const cp = [];
    paths.slice(0, 3).forEach((p, i) => { const nm = `${code}_${i + 1}.jpg`; try { fs.copyFileSync(p, `${anex}/${nm}`); cp.push(nm); } catch {} });
    if (cp.length) embed = "\n" + cp.map((n) => `![[_anexos/${n}]]`).join("\n") + "\n";
  }
  try { fs.rmSync(out, { recursive: true, force: true }); } catch {}
  const passos = (rec.passos || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
  fs.appendFileSync(notePath, `## ${rec.titulo}${isPhoto ? " 📎" : ""}\n*Post: [abrir](${url})*\n\n> [!tip] ${rec.sacada || ""}\n\n${passos}\n${rec.cuidado ? `\n> [!warning] ${rec.cuidado}\n` : ""}${embed}\n---\n\n`);
  it.detalhe = true; it.n = rt.note; it.vault = rt.vault;
  done++; log(`[ok:${rt.vault}] ${code} — ${rec.titulo}`);
  fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
  await new Promise((s) => setTimeout(s, 1200));
}
fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
log(`=== FIM: ok ${done} · skip ${skip} · dup ${dup} · fail ${fail} ===`);
