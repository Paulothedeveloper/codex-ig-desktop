// 2º CÉREBRO — organizador dos Salvos SEM IA (determinístico, offline, zero crédito).
// Não usa Gemini/OpenAI/Groq. Usa só o que o IG já entrega no salvo: LEGENDA + capa + link.
// Classifica por palavra-chave na legenda -> vault do tema -> nota Obsidian (legenda + capa + tags).
// Args: argv[2] = "codes:c1,c2" | número N (últimos N) | vazio(=100). argv[3] = "vault:<Nome>" | vazio(auto).
import fs from "node:fs";
import os from "node:os";

const HOME = os.homedir();
const VAULTS = "<vaults-root>";
const DV = `${VAULTS}/WINDOWS - DAVINCI RESOLVE/7 - REELS (biblioteca)`;
const STATE = `${VAULTS}/_INBOX-SALVOS/_FILA-ESTADO.json`;
const LOG = `${os.tmpdir()}/codexig-absorb/absorb.log`;
fs.mkdirSync(`${os.tmpdir()}/codexig-absorb`, { recursive: true });
const log = (m) => { try { fs.appendFileSync(LOG, m + "\n"); } catch {} console.log(m); };

const destArg = (process.argv[3] || "").trim();
const FORCED = destArg.startsWith("vault:") ? destArg.slice(6).trim() : null;

// ---- ROTA determinística: legenda -> {vault, dir, note}. 1 assunto sempre no mesmo lugar (sem IA).
function route(text) {
  if (FORCED) return { vault: FORCED, dir: `${VAULTS}/${FORCED}`, note: "Salvos organizados" };
  const t = (text || "").toLowerCase();
  const davinci = /davinci|resolve|\bcor\b|color|grad|\blut\b|dctl|edi[çc][aã]o|edit(?!al)|corte|transi|fusion|\bvfx\b|motion|keyframe|\baudio\b|\bsom\b|fairlight|legenda|caption|subtitle|plugin|premiere|after ?effects|capcut|filmmak|cinematic|c[aâ]mera|fotograf|\bfoto\b|ilumina|\bluz\b|composi[çc]|enquadr|\blente\b|exposi[çc]|slow ?motion|\bvideo\b|v[ií]deo|reel|storytell|roteir|gravar|captac|edicao de video/;
  if (davinci.test(t)) {
    let note = "99i ✂️ - Salvos — EDIÇÃO";
    if (/\bcor\b|color|grad|\blut\b|dctl|tonal|cinematic|colorist/.test(t)) note = "99h 🎨 - Salvos — COLOR";
    else if (/fusion|\bvfx\b|\b3d\b|track|composit|magic ?mask/.test(t)) note = "99j 🧩 - Salvos — FUSION";
    else if (/\baudio\b|\bsom\b|music|fairlight|\bvoz\b|sfx/.test(t)) note = "99k 🔊 - Salvos — ÁUDIO";
    else if (/legenda|caption|subtitle|texto na tela/.test(t)) note = "99l 🔤 - Salvos — LEGENDA";
    else if (/plugin|preset|template|after ?effects|capcut/.test(t)) note = "99m 🔌 - Salvos — PLUGIN";
    else if (/c[aâ]mera|fotograf|\bfoto\b|ilumina|\bluz\b|composi[çc]|enquadr|\blente\b|exposi[çc]|gravar|captac|slow ?motion/.test(t)) note = "99n 🎥 - Salvos — PRODUÇÃO & CÂMERA";
    return { vault: "WINDOWS - DAVINCI RESOLVE", dir: DV, note };
  }
  if (/concurso|edital|estudo|prova|questao|questão|oab|cespe|vunesp|jurisprud|constituc|direito/.test(t))
    return { vault: "ESTUDOS - CONCURSO", dir: `${VAULTS}/ESTUDOS - CONCURSO`, note: "Estudo — salvos" };
  if (/\bia\b|intelig|automa|prompt|chatgpt|\bgpt\b|claude|midjourney|runway|gemini|agente|\bn8n\b|machine learning|\bllm\b/.test(t))
    return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "IA & Automação — salvos" };
  if (/marketing|trafego|tráfego|anuncio|anúncio|copywrit|funil|lead|convers[aã]o|engajamento|algoritmo|viral/.test(t))
    return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "Marketing — salvos" };
  if (/design|figma|ui\b|ux\b|tipografia|paleta|logo|branding|photoshop|illustrator/.test(t))
    return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "Design — salvos" };
  if (/negocio|negócio|empreend|vendas|financ|dinheiro|invest|lucro|renda|precific/.test(t))
    return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "Negócio & Finanças — salvos" };
  return { vault: "IDEIAS SALVAS", dir: `${VAULTS}/IDEIAS SALVAS`, note: "Outros — salvos" };
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
function ensureNote(dir, note) {
  fs.mkdirSync(dir, { recursive: true });
  const p = `${dir}/${note}.md`;
  if (!fs.existsSync(p)) fs.writeFileSync(p, `---\ntipo: salvos\ntags: [salvos, segundo-cerebro]\norigem: _INBOX-SALVOS (Codex IG)\n---\n\n# ${note.replace(/^[0-9a-z]+ /i, "")}\n\n> [!info] Reels/posts que você salvou no Instagram, organizados por tema (Codex IG — sem IA).\n\n`);
  return p;
}
function titlesOf(p) { if (!fs.existsSync(p)) return new Set(); return new Set(fs.readFileSync(p, "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => norm(l.slice(3)))); }

// legenda -> título curto (1ª linha útil, sem hashtags), tags (hashtags), corpo limpo.
function parseCaption(cap, isVideo) {
  const raw = (cap || "").trim();
  const tags = [...new Set((raw.match(/#[\p{L}\d_]+/gu) || []).map((h) => h.slice(1).toLowerCase()))].slice(0, 10);
  // corpo = legenda sem a enxurrada de hashtags do fim (mantém hashtag no meio de frase)
  const body = raw.replace(/(^|\s)#[\p{L}\d_]+/gu, (m, p) => (p === " " ? " " : p)).replace(/\n{3,}/g, "\n\n").trim();
  // título = 1ª linha não-vazia do corpo, até ~90 chars; senão fallback
  let title = (body.split("\n").map((l) => l.trim()).find((l) => l.length > 1) || "").replace(/["*_`>#]/g, "").slice(0, 90).trim();
  if (!title) title = isVideo ? "Reel salvo (sem legenda)" : "Post salvo (sem legenda)";
  return { title, tags, body };
}

async function downloadThumb(url, dest) {
  if (!url) return false;
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) return false; // capa vazia/erro
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
}

// ---- self-test (node organize_saved.mjs --selftest): valida a lógica sem tocar no vault/estado ----
if (process.argv[2] === "--selftest") {
  const a = parseCaption("Como fazer color grading no DaVinci\n\nDica top\n#davinci #colorgrading #edit", true);
  console.assert(a.tags.includes("davinci") && a.tags.includes("colorgrading"), "FAIL tags");
  console.assert(a.title.startsWith("Como fazer color"), "FAIL title=" + a.title);
  console.assert(!/#davinci/.test(a.body), "FAIL body ainda tem hashtag");
  console.assert(route("dicas de color grading e lut").note.includes("COLOR"), "FAIL route color");
  console.assert(route("tutorial de fusion e magic mask").note.includes("FUSION"), "FAIL route fusion");
  console.assert(route("edital do concurso da PF, jurisprudencia").vault === "ESTUDOS - CONCURSO", "FAIL route concurso");
  console.assert(route("prompt de chatgpt pra automacao n8n").vault === "IDEIAS SALVAS" && route("prompt de chatgpt").note.includes("IA"), "FAIL route ia");
  console.assert(route("estrategia de trafego pago e funil").note.includes("Marketing"), "FAIL route mkt");
  console.assert(route("xyzabc nada a ver").note.includes("Outros"), "FAIL route outros");
  const b = parseCaption("", true);
  console.assert(b.title.includes("sem legenda"), "FAIL title vazio");
  console.log("SELFTEST OK");
  process.exit(0);
}

// ---- seleção ----
const arg = (process.argv[2] || "100").trim();
const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
let codes;
if (arg.startsWith("codes:")) codes = arg.slice(6).split(",").map((s) => s.trim()).filter(Boolean);
else codes = Object.keys(st.items).slice(0, parseInt(arg, 10) || 100);

log(`\n=== ORGANIZAR ${new Date().toISOString()} — ${codes.length} salvos (sem IA) -> ${FORCED ? "vault: " + FORCED : "auto por tema"} ===`);
let done = 0, skip = 0, dup = 0, fail = 0;
const titleCache = {};
for (const code of codes) {
  const it = st.items[code] || (st.items[code] = { s: "queued" });
  if (it.org) continue; // já organizado por este motor
  const url = `https://www.instagram.com/p/${code}/`;
  const cap = it.cap || "";
  const isVideo = !!it.isv;
  // sem legenda E sem capa = nada pra organizar (reel mudo não baixado) -> marca skip, some da fila
  if (!cap && !it.thumb) { it.org = true; it.n2 = "(sem conteúdo)"; skip++; log(`[skip] ${code} — sem legenda/capa`); fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  const { title, tags, body } = parseCaption(cap, isVideo);
  const rt = route(cap);
  const notePath = ensureNote(rt.dir, rt.note);
  titleCache[notePath] = titleCache[notePath] || titlesOf(notePath);
  if (titleCache[notePath].has(norm(title))) { it.org = true; it.n2 = rt.note; it.vault2 = rt.vault; dup++; log(`[dup] ${code} — ${title}`); fs.writeFileSync(STATE, JSON.stringify(st, null, 0)); continue; }
  titleCache[notePath].add(norm(title));
  // capa -> baixa e embute (grátis; a URL do IG expira, por isso salva local)
  let embed = "";
  if (it.thumb) {
    const anex = `${rt.dir}/_anexos`; fs.mkdirSync(anex, { recursive: true });
    const nm = `${code}.jpg`;
    if (await downloadThumb(it.thumb, `${anex}/${nm}`)) embed = `\n![[_anexos/${nm}]]\n`;
  }
  const dateStr = it.ts ? new Date(it.ts * 1000).toISOString().slice(0, 10) : "";
  const tagLine = tags.length ? `\n\n**Tags:** ${tags.map((x) => "#" + x).join(" ")}` : "";
  const kind = isVideo ? "Reel" : "Post";
  const bodyOut = body && body !== title ? `\n\n${body}` : (cap ? "" : `\n\n> Sem legenda — abra o ${kind.toLowerCase()} para ver.`);
  fs.appendFileSync(notePath, `## ${title}\n*${kind} salvo · [abrir no Instagram](${url})${dateStr ? " · " + dateStr : ""}*${bodyOut}\n${embed}${tagLine}\n\n---\n\n`);
  it.org = true; it.n2 = rt.note; it.vault2 = rt.vault;
  done++; log(`[ok:${rt.vault}] ${code} — ${title}`);
  fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
}
fs.writeFileSync(STATE, JSON.stringify(st, null, 0));
log(`=== FIM: ok ${done} · skip ${skip} · dup ${dup} · fail ${fail} ===`);
