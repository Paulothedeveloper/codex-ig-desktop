import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";
import Help from "../Help";
import Loading from "../Loading";

// Base do algoritmo IG 2026 (pesquisa web jan-ago/2026) — embutida no system prompt.
// "Manter atualizado" = editar aqui + a nota do vault. Botão Atualizar puxa artigo fresco.
const ALGO_2026 = `Algoritmo Instagram 2026 (o que faz viralizar):
- Feed, Reels, Stories e Explore tem ranking SEPARADO (IAs distintas).
- Hook nos 3 primeiros segundos; meta 60%+ de retencao. Sem hook = morre.
- Rewatchability e SHARES no DM sao o sinal #1 de alcance novo. CTA "manda pra alguem" > "comenta".
- Pattern interrupt / visual hook / texto na tela nos primeiros frames.
- Sinais: watch time, replays, shares (DM), saves, comentarios, seguir apos ver.
- Formato: vertical 9:16, texto na tela (veem sem som), legenda embutida, corte rapido.
- Nicho claro + consistencia (a IA precisa saber pra quem entregar).`;

const TSE_2026 = `Regras TSE Eleicoes 2026 (Resolucao 23.755/2026):
- Propaganda eleitoral (pedir voto) SO a partir de 16/08/2026, inclusive internet.
- Conteudo gerado/alterado por IA precisa ser ROTULADO.
- Proibido conteudo fabricado/deepfake (voz/imagem falsa, fato inveridico).
- Impulsionamento pago so identificado, por candidato/partido com CNPJ eleitoral.`;

type Mode = "analyze" | "script" | "caption";
// Intuito de uso — o app serve qualquer nicho, o usuário escolhe. Política tem guardrail TSE.
const USE_CASES = ["politica", "negocio", "criador", "geral"] as const;
type UseCase = typeof USE_CASES[number];

export default function Estudio() {
  const { t } = useI18n();
  const groqKey = () => localStorage.getItem("codexig_groq") || "";
  const [mode, setMode] = useState<Mode>("analyze");
  const [useCase, setUseCase] = useState<UseCase>(() => (localStorage.getItem("codexig_usecase") as UseCase) || "politica");
  const isPol = useCase === "politica";
  const [text, setText] = useState("");
  const [theme, setTheme] = useState("");
  const [caption, setCaption] = useState("");
  const [goal, setGoal] = useState("alcance");
  const [format, setFormat] = useState("reel");
  const [algo, setAlgo] = useState(() => localStorage.getItem("codexig_algo") || ALGO_2026);
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function run() {
    const key = groqKey().trim();
    if (!key) { setErr(t("estudio.needKey")); return; }
    if (mode === "analyze" && !text.trim()) return;
    if (mode === "script" && !theme.trim()) return;
    if (mode === "caption" && !caption.trim()) return;
    setBusy(mode === "analyze" ? t("estudio.analyzing") : mode === "caption" ? t("estudio.captioning") : t("estudio.generating"));
    setErr(""); setOut("");
    try {
      const persona = t("estudio.persona_" + useCase);
      const sys = `Voce e estrategista de conteudo viral pra Instagram para ${persona}. Use ESTE conhecimento atualizado do algoritmo:\n${algo}\n` +
        (isPol ? `\nRespeite SEMPRE estas regras eleitorais:\n${TSE_2026}\nSe o conteudo pedir voto e for antes de 16/08/2026, avise. Se usar IA na peca final, lembre de rotular.` : "") +
        `\nPT-BR, direto, sem encher linguica.`;
      let user = "";
      if (mode === "caption") {
        user = `Escreva 3 LEGENDAS prontas pra Instagram sobre: "${caption.slice(0, 1500)}". Objetivo: ${t("estudio.goal_" + goal)}.\nPra cada legenda:\n- 1a linha = GANCHO forte (para o scroll)\n- corpo curto e escaneavel\n- CTA (de preferencia pedindo SHARE no DM)\n- 5-8 hashtags certeiras\nRotule as 3 versoes: CURTA, MEDIA, HISTORIA (storytelling).` + (isPol ? `\nSe pedir voto, adicione o ALERTA ELEITORAL.` : "");
      } else if (mode === "analyze") {
        user = `Analise CRITICAMENTE este conteudo (legenda, roteiro ou transcricao de video) pra viralizar no Instagram:\n"""${text.slice(0, 4000)}"""\n\nResponda:\n1) NOTA DE 0 A 10 (potencial viral) + 1 frase\n2) HOOK (os 3s iniciais funcionam? como melhorar)\n3) RETENCAO (o que faz assistir ate o fim / reassistir)\n4) CTA (pede SHARE no DM? conserta)\n5) PALAVRAS/GANCHOS a usar e a evitar\n6) HASHTAGS sugeridas (poucas, certeiras)\n7) FORMATO/EDICAO (texto na tela, corte, duracao)\n8) VERSAO MELHORADA da legenda\n9) ALERTA ELEITORAL (se aplicavel)`;
      } else {
        const fmt = t("estudio.fmt_" + format), gl = t("estudio.goal_" + goal);
        user = `Escreva um ROTEIRO completo de ${fmt} pra Instagram com objetivo de ${gl}. Tema: "${theme}".\n\nEstrutura:\n- HOOK (fala + texto na tela dos 3s iniciais, 2-3 opcoes)\n- DESENVOLVIMENTO (beats com o que falar e o que mostrar)\n- CTA (pedindo compartilhamento no DM)\n- TEXTO NA TELA (overlays por trecho)\n- SUGESTAO DE EDICAO (cortes, ritmo, duracao ideal)\n- LEGENDA pronta + hashtags\n- ALERTA ELEITORAL se pedir voto`;
      }
      const res = await invoke<string>("ai_chat", { system: sys, user, key, json: false });
      setOut(res);
    } catch (e) { setErr(String(e)); } finally { setBusy(""); }
  }

  async function refreshAlgo() {
    setBusy(t("estudio.updating")); setErr("");
    try {
      const sk = localStorage.getItem("codexig_serper") || "";
      const hits = await invoke<{ title: string; link: string; snippet: string }[]>("web_search", { query: "Instagram algorithm 2026 reels ranking how to go viral", key: sk, endpoint: "search", num: 6, tbs: "qdr:m" });
      const top = hits.slice(0, 4);
      const first = top[0]?.link;
      let page = "";
      if (first) { try { page = await invoke<string>("fetch_page", { url: first }); } catch { /* */ } }
      const sys = "Voce resume o estado ATUAL do algoritmo do Instagram pra criadores. Bullets curtos, so o que muda alcance/viralizacao. PT-BR.";
      const user = `Fontes recentes:\n` + top.map((h) => `- ${h.title}: ${h.snippet}`).join("\n") + (page ? `\n\nArtigo:\n${page.slice(0, 4000)}` : "") + `\n\nResuma o algoritmo do Instagram HOJE em 6-9 bullets pra viralizar.`;
      const res = await invoke<string>("ai_chat", { system: sys, user, key: groqKey().trim(), json: false });
      if (res && res.length > 40) { setAlgo(res); localStorage.setItem("codexig_algo", res); }
    } catch (e) { setErr(String(e)); } finally { setBusy(""); }
  }

  const Sel = ({ v, set, opts, label }: { v: string; set: (x: string) => void; opts: string[]; label: string }) => (
    <label className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{label}
      <select value={v} onChange={(e) => set(e.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--color-line)] bg-[#090d15] px-3 py-2 text-[13px] text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)]">
        {opts.map((o) => <option key={o} value={o}>{t("estudio." + (label === t("estudio.goal") ? "goal_" : "fmt_") + o)}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-3 flex items-start gap-1.5">
          <p className="text-[13px] leading-snug text-[var(--color-slate)]">{t("estudio.intro")}</p>
          <Help label={t("nav.estudio.label")} text={t("help.estudio")} />
        </div>
        {/* intuito de uso — o app serve qualquer nicho */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("estudio.useCase")} <Help label={t("estudio.useCase")} text={t("help.usecase")} /></span>
          {USE_CASES.map((u) => (
            <button key={u} onClick={() => { setUseCase(u); localStorage.setItem("codexig_usecase", u); setOut(""); }} className={`rounded-full border px-3 py-1 text-[12px] font-bold ${useCase === u ? "border-[var(--color-teal)] bg-[var(--color-teal)]/15 text-[var(--color-teal2)]" : "border-[var(--color-steel)] bg-[#0e1522] text-[var(--color-slate)]"}`}>{t("estudio.uc_" + u)}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setMode("analyze"); setOut(""); }} className={"rounded-xl px-4 py-2 text-[13px] font-bold border " + (mode === "analyze" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)]")}>{t("estudio.tabAnalyze")}</button>
          <button onClick={() => { setMode("script"); setOut(""); }} className={"rounded-xl px-4 py-2 text-[13px] font-bold border " + (mode === "script" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)]")}>{t("estudio.tabScript")}</button>
          <button onClick={() => { setMode("caption"); setOut(""); }} className={"rounded-xl px-4 py-2 text-[13px] font-bold border " + (mode === "caption" ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f] border-transparent" : "bg-[#0e1522] border-[var(--color-steel)] text-[var(--color-slate)]")}>{t("estudio.tabCaption")}</button>
        </div>

        {mode === "analyze" ? (
          <div className="mt-4">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={t("estudio.analyzePh")} className="w-full resize-y rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
          </div>
        ) : mode === "caption" ? (
          <div className="mt-4 space-y-3">
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder={t("estudio.captionPh")} className="w-full resize-y rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" />
            <div className="max-w-[240px]"><Sel v={goal} set={setGoal} opts={["alcance", "engajamento", "seguidores", "conversao"]} label={t("estudio.goal")} /></div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder={t("estudio.themePh")} className="w-full rounded-xl border border-[var(--color-line)] bg-[#090d15] px-3 py-2.5 text-[13px] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-slate)] focus:border-[var(--color-teal)]" /></div>
            <Sel v={format} set={setFormat} opts={["reel", "story", "carousel", "post"]} label={t("estudio.format")} />
            <Sel v={goal} set={setGoal} opts={["alcance", "engajamento", "seguidores", "conversao"]} label={t("estudio.goal")} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={run} disabled={!!busy} className="rounded-xl bg-[linear-gradient(135deg,#00e5c9,#0aa892)] px-5 py-2.5 font-bold text-[#04120f] hover:brightness-110 active:scale-[.99] disabled:opacity-50">{busy || (mode === "analyze" ? t("estudio.analyze") : mode === "caption" ? t("estudio.captionGo") : t("estudio.generate"))}</button>
          {out && <button onClick={() => navigator.clipboard.writeText(out)} className="rounded-xl border border-[var(--color-steel)] bg-[#0e1522] px-4 py-2.5 text-[13px] font-bold text-[var(--color-paper)]">{t("busca.copyReply")}</button>}
        </div>
        {err && <div className="mt-3 rounded-lg border border-[#43221d] bg-[#1a0e0c] px-3 py-2 text-[12.5px] text-[var(--color-coral2)]">{err}</div>}
      </div>

      {busy && !out && <Loading label={busy} steps={mode === "analyze" ? [t("estudio.step1"), t("estudio.step2"), t("estudio.step3")] : mode === "caption" ? [t("estudio.stepC1"), t("estudio.stepC2")] : [t("estudio.stepR1"), t("estudio.stepR2"), t("estudio.stepR3")]} />}
      {out && (
        <div className="pop rounded-2xl border border-[var(--color-teal)]/40 bg-[var(--color-panel)] p-5">
          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{out}</p>
        </div>
      )}

      {/* guardrail eleitoral TSE — só no modo política */}
      {isPol && (
      <div className="rounded-2xl border border-[#ffd166]/40 bg-[#1a1608] p-4">
        <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[#ffd166]">{t("estudio.tseTitle")} <Help label="TSE 2026" text={t("help.tse")} /></div>
        <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-[var(--color-slate)]">{TSE_2026}</p>
      </div>
      )}

      {/* algoritmo atual + atualizar */}
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-[var(--color-slate)]">{t("estudio.algoTitle")}</span>
          <button onClick={refreshAlgo} disabled={!!busy} className="rounded-lg border border-[var(--color-steel)] bg-[#0e1522] px-3 py-1.5 text-[12px] font-bold text-[var(--color-teal2)] disabled:opacity-50">{t("estudio.updateAlgo")}</button>
        </div>
        <p className="whitespace-pre-line text-[12px] leading-relaxed text-[var(--color-slate)]">{algo}</p>
      </div>
    </div>
  );
}
