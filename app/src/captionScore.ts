// captionScore.ts — Nota da Legenda (motor DETERMINISTICO, zero IA, zero rede).
//
// Copia o metodo das ferramentas padrao de mercado, adaptado pra legenda de Instagram PT-BR:
//  - CoSchedule Headline Analyzer  -> "word balance" (comum/incomum/emocional/poder),
//    comprimento, tipo de legenda, sentimento, legibilidade. (coschedule.com/headline-analyzer)
//  - EMV / Advanced Marketing Institute -> EMV% = palavras emocionais / total de palavras.
//    Benchmark do AMI: 30-40% = copywriter profissional, 50-75% = excelente. (aminstitute.com/headline)
//  - Flesch adaptado ao PT (Martins et al.): ILF = 248.835 - 1.015*(palavras/frases) - 84.6*(silabas/palavras).
//  - Boas praticas do IG: 1a linha (gancho) visivel em ~125 chars antes do "... mais";
//    hashtags certeiras 3-8; CTA pedindo compartilhamento; escaneabilidade (quebras de linha).
//
// Tudo eh reproduzivel: mesma legenda -> mesma nota, sempre. Nada de "acho que".

export type Grade = "A" | "B" | "C" | "D";

export interface Component {
  key: string;      // id p/ i18n (score.c.<key>)
  score: number;    // 0..1 (fracao atingida)
  weight: number;   // peso no total
  detail: string;   // i18n key da dica/estado (score.d.<detail>) — feedback concreto
  value?: string;   // valor medido pra mostrar (ex "142 chars", "5 hashtags", "EMV 38%")
}

export interface ScoreResult {
  total: number;            // 0..100
  grade: Grade;
  components: Component[];   // barras da UI
  emvPct: number;           // % de palavras emocionais (metodo AMI)
  emvClass: "intellectual" | "empathetic" | "spiritual" | "none";
  fixes: string[];          // i18n keys das correcoes priorizadas (score.fix.<...>)
  words: number;
  chars: number;
  hashtags: number;
}

// ------------------------------------------------------------------ lexicos PT-BR
// Listas curadas (como as ferramentas reais: um lexico fixo). Minusculas, sem acento
// na comparacao (normalizamos). Focadas no que move alcance/conversao em PT-BR.

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Palavras de PODER / gatilho (persuasao, urgencia, prova). CoSchedule "power words".
const POWER = new Set(
  [
    "gratis", "agora", "novo", "nova", "comprovado", "segredo", "segredos", "exclusivo", "exclusiva",
    "garantido", "garantia", "resultado", "resultados", "rapido", "rapida", "facil", "definitivo",
    "urgente", "ultimas", "ultima", "oferta", "descubra", "descobri", "aprenda", "evite", "pare",
    "atencao", "imperdivel", "transforme", "transformacao", "poderoso", "incrivel", "chocante",
    "surpreendente", "prova", "passo", "metodo", "formula", "truque", "hack", "erro", "erros",
    "nunca", "sempre", "hoje", "so", "somente", "limitado", "vaga", "vagas", "bonus", "prova",
    "dinheiro", "lucro", "economize", "ganhe", "voce", "seu", "sua", "melhor", "pior", "top",
    "essencial", "fundamental", "instantaneo", "definitiva", "revelado", "verdade", "mentira",
  ].map(norm)
);

// Palavras EMOCIONAIS (metodo EMV) + 3 categorias do AMI.
const EMO_INTEL = ["inteligente", "estrategia", "logico", "descoberta", "inovador", "eficiente", "solucao", "vantagem", "oportunidade", "conhecimento", "dado", "prova", "resultado", "metodo"];
const EMO_EMPATH = ["amor", "medo", "sonho", "orgulho", "raiva", "feliz", "felicidade", "triste", "tristeza", "esperanca", "coragem", "paixao", "saudade", "gratidao", "surpresa", "alivio", "forca", "luta", "vitoria", "perda", "familia", "amigo", "junto", "coracao", "sentir", "emocao", "verdade", "sozinho", "cuidar"];
const EMO_SPIRIT = ["destino", "proposito", "fe", "alma", "sagrado", "milagre", "eterno", "gratidao", "luz", "energia", "universo", "transformacao", "despertar", "liberdade", "paz"];
const EMO_ALL = new Set([...EMO_INTEL, ...EMO_EMPATH, ...EMO_SPIRIT].map(norm));
const EMO_I = new Set(EMO_INTEL.map(norm));
const EMO_E = new Set(EMO_EMPATH.map(norm));
const EMO_S = new Set(EMO_SPIRIT.map(norm));

// CTA — verbos de acao que pedem interacao (share no DM = sinal #1 do IG).
const CTA = [
  "compartilhe", "compartilha", "marca", "marque", "manda", "mande", "envia", "envie", "salva",
  "salve", "comenta", "comente", "clica", "clique", "arrasta", "arraste", "segue", "siga",
  "participa", "participe", "responde", "responda", "conta", "conte", "acesse", "baixe", "assista",
  "curta", "compartilhar", "salvar", "link na bio", "chama no dm", "manda pra", "envia pra",
].map(norm);

const CTA_RE = new RegExp("\\b(" + CTA.map((c) => c.replace(/ /g, "\\s+")).join("|") + ")\\b", "i");

// ------------------------------------------------------------------ helpers
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function words(text: string): string[] {
  return (text.match(/[\p{L}\p{N}']+/gu) || []).map(norm).filter(Boolean);
}
function sentences(text: string): number {
  const s = text.split(/[.!?\n]+/).map((x) => x.trim()).filter(Boolean);
  return Math.max(1, s.length);
}
function syllables(w: string): number {
  // aproximacao PT: grupos de vogais contam como 1 silaba (bom o suficiente p/ Flesch).
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}
function fleschPT(text: string): number {
  const ws = words(text);
  if (ws.length === 0) return 0;
  const wps = ws.length / sentences(text);
  const sylTotal = ws.reduce((a, w) => a + syllables(w), 0);
  const spw = sylTotal / ws.length;
  return 248.835 - 1.015 * wps - 84.6 * spw; // ILF (Flesch adaptado ao PT)
}

// mapeia um valor pra 0..1 com um "platô" ideal [lo,hi] e quedas fora dele.
function band(v: number, lo: number, hi: number, floorLo: number, floorHi: number): number {
  if (v >= lo && v <= hi) return 1;
  if (v < lo) return Math.max(0, (v - floorLo) / (lo - floorLo));
  return Math.max(0, (floorHi - v) / (floorHi - hi));
}

// ------------------------------------------------------------------ motor
export function scoreCaption(input: string): ScoreResult {
  const text = (input || "").trim();
  const ws = words(text);
  const wcount = ws.length;
  const chars = [...text].length;

  // legenda vazia = nota 0 (nao dar pontos-base de hashtag/scan/pergunta pra nada).
  if (wcount === 0) {
    return { total: 0, grade: "D", components: [], emvPct: 0, emvClass: "none", fixes: [], words: 0, chars: 0, hashtags: 0 };
  }

  const hashtags = (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
  const firstLine = text.split("\n")[0] || "";
  const firstLineChars = [...firstLine].length;
  const hasQuestion = /\?/.test(text) || /\b(voce sabia|sabia que|por que|porque|como|o que|qual)\b/i.test(norm(text));
  const breaks = (text.match(/\n/g) || []).length;

  // contagens de lexico
  let power = 0, emo = 0;
  let emoI = 0, emoE = 0, emoS = 0;
  for (const w of ws) {
    if (POWER.has(w)) power++;
    if (EMO_ALL.has(w)) { emo++; if (EMO_I.has(w)) emoI++; if (EMO_E.has(w)) emoE++; if (EMO_S.has(w)) emoS++; }
  }
  const hasCta = CTA_RE.test(text);

  const emvPct = wcount ? Math.round((emo / wcount) * 100) : 0;
  const emvClass: ScoreResult["emvClass"] =
    emo === 0 ? "none" : emoE >= emoI && emoE >= emoS ? "empathetic" : emoS >= emoI ? "spiritual" : "intellectual";

  // ---- componentes (cada um score 0..1 * peso) ----
  const C: Component[] = [];

  // 1) GANCHO (1a linha) — visivel antes do "... mais" (~125 chars). Peso 20.
  //    ideal: 1a linha 20-120 chars, com poder/emocao/pergunta.
  {
    let s = band(firstLineChars, 20, 120, 0, 220);
    const punch = power > 0 || emo > 0 || hasQuestion || EMOJI_RE.test(firstLine);
    s = s * (punch ? 1 : 0.55);
    C.push({ key: "hook", score: s, weight: 20, value: `${firstLineChars} chars`,
      detail: firstLineChars === 0 ? "hookEmpty" : firstLineChars > 125 ? "hookLong" : punch ? "hookGood" : "hookWeak" });
  }
  // 2) EMOCAO (EMV%) — metodo AMI. Peso 18. 30-40 bom, 50-75 excelente.
  {
    const s = emvPct >= 50 ? 1 : emvPct >= 30 ? 0.8 : emvPct >= 15 ? 0.55 : emvPct > 0 ? 0.3 : 0;
    C.push({ key: "emv", score: s, weight: 18, value: `EMV ${emvPct}%`,
      detail: emvPct >= 30 ? "emvGood" : emvPct > 0 ? "emvLow" : "emvNone" });
  }
  // 3) PALAVRAS DE PODER — CoSchedule power words. Peso 12. ideal 1-4 (denso sem exagero).
  {
    const density = wcount ? power / wcount : 0;
    const s = power === 0 ? 0 : band(power, 1, 5, 0, 12) * (density > 0.35 ? 0.7 : 1);
    C.push({ key: "power", score: s, weight: 12, value: `${power}`,
      detail: power === 0 ? "powerNone" : "powerGood" });
  }
  // 4) LEGIBILIDADE (Flesch PT). Peso 15. 50+ facil de ler no feed.
  {
    const f = fleschPT(text);
    const s = f >= 60 ? 1 : f >= 45 ? 0.75 : f >= 30 ? 0.5 : f > 0 ? 0.3 : 0;
    C.push({ key: "read", score: s, weight: 15, value: `Flesch ${Math.round(f)}`,
      detail: f >= 50 ? "readGood" : "readHard" });
  }
  // 5) CTA (pede interacao/share). Peso 12.
  {
    C.push({ key: "cta", score: hasCta ? 1 : 0, weight: 12, value: hasCta ? "ok" : "-",
      detail: hasCta ? "ctaGood" : "ctaNone" });
  }
  // 6) HASHTAGS. Peso 10. ideal 3-8; 0 = fraco; >15 = spammy.
  {
    const s = hashtags === 0 ? 0.2 : band(hashtags, 3, 8, 0, 20);
    C.push({ key: "tags", score: s, weight: 10, value: `${hashtags}`,
      detail: hashtags === 0 ? "tagsNone" : hashtags > 12 ? "tagsMany" : hashtags < 3 ? "tagsFew" : "tagsGood" });
  }
  // 7) ESCANEABILIDADE — quebras + tamanho de corpo. Peso 8.
  {
    // corpo longo sem quebras = bloco macico; ideal ter quebras se passar de ~200 chars.
    let s = 1;
    if (chars > 200 && breaks < 1) s = 0.4;
    else if (chars > 400 && breaks < 3) s = 0.6;
    else if (chars < 40) s = 0.6; // curto demais tambem perde profundidade
    C.push({ key: "scan", score: s, weight: 8, value: `${breaks} quebras`,
      detail: s >= 1 ? "scanGood" : chars < 40 ? "scanShort" : "scanWall" });
  }
  // 8) PERGUNTA / ENGAJAMENTO. Peso 5.
  {
    C.push({ key: "quest", score: hasQuestion ? 1 : 0.3, weight: 5, value: hasQuestion ? "ok" : "-",
      detail: hasQuestion ? "questGood" : "questNone" });
  }

  const total = Math.round(C.reduce((a, c) => a + c.score * c.weight, 0));
  const grade: Grade = total >= 80 ? "A" : total >= 65 ? "B" : total >= 45 ? "C" : "D";

  // correcoes: pega os componentes mais fracos (menor score*peso perdido) e vira dica priorizada.
  const fixes = C
    .filter((c) => c.score < 0.75)
    .sort((a, b) => (b.weight * (1 - b.score)) - (a.weight * (1 - a.score)))
    .slice(0, 4)
    .map((c) => c.detail);

  return { total, grade, components: C, emvPct, emvClass, fixes, words: wcount, chars, hashtags };
}
