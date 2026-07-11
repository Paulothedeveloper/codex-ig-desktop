<h1 align="center">Codex IG Desktop</h1>

<p align="center">
  App desktop de crescimento, relatório e cliques do <b>seu próprio</b> Instagram —<br>
  roda na <b>sua sessão real</b>, local, sem bot de login e sem loja.
</p>

<p align="center">
  <img alt="tauri" src="https://img.shields.io/badge/Tauri-2-00e5c9?style=flat&labelColor=0b0e17">
  <img alt="rust" src="https://img.shields.io/badge/Rust-1.95-ff4d3d?style=flat&labelColor=0b0e17">
  <img alt="local" src="https://img.shields.io/badge/100%25-local-8892a0?style=flat&labelColor=0b0e17">
</p>

---

## O que é

Um **navegador-Codex dedicado**: abre o instagram.com onde **você loga normal** (a sua sessão), e o app lê essa sessão pra entregar, em telas nativas:

- **Instagram** — *Limpar* (deixar de seguir quem não retribui, ritmado, com whitelist e parada automática) + *Alvos* (seguidores de concorrentes = seu público).
- **Relatório** — seguindo/seguidores/não-retribuem/mútuos/fãs, engajamento e top posts dos últimos posts, **crescimento de seguidores no tempo** (SQLite local) e quem deixou de te seguir.
- **Cliques** — gerencia o tracker de links da bio (worker próprio), com contagem de cliques.
- **Config** — conta, whitelist, export CSV, privacidade.

## Por que assim (honesto)

A Graph API oficial **não lista seguidores** — só a sessão web dá. Todo tool que dependeu da API oficial morreu; todo que abusou de escrita foi banido. Por isso: **muito-leitura, escrita-ritmada, snapshot-diff, na sua própria sessão**. Não é bot de login (bane), não passa por loja (reprova app que automatiza Instagram) → **download direto**. Leitura = risco baixo; unfollow = você define o ritmo, com medidor de risco e parada automática no bloqueio.

## Privacidade

Tudo **local**. Cookies lidos em runtime, **nunca gravados** por nós. Dados no seu aparelho (SQLite). Sem servidor de terceiro, sem PII. As chaves do tracker ficam no app.

## Stack

Tauri 2 · Rust (`reqwest`, `rusqlite` via `tauri-plugin-sql`) · React + Vite + TypeScript + Tailwind v4 · identidade **Codex Arena**, fonte Space Grotesk self-hosted.

## Rodar (dev)

```bash
cd app
npm install
npm run tauri dev
```

Design e plano em [`docs/superpowers/`](docs/superpowers/). Marca em [`brand/`](brand/).

---

<p align="center"><sub>Feito no estúdio <a href="https://paulocodex.com">Paulocodex</a> · uso pessoal</sub></p>
