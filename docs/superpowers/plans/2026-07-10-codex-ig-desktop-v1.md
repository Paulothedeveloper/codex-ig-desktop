# Codex IG Desktop v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App desktop (Windows-first) que roda a sessão real do Instagram do usuário para growth (unfollow ritmado, alvos), relatório local e gerência do tracker de cliques — sem bot de login, sem loja.

**Architecture:** Motor B — Tauri 2 hospeda a UI nativa (origem própria) + um webview filho no instagram.com (usuário loga normal). O lado Rust lê os cookies da sessão do WebView2 e chama a API web interna do IG, gravando snapshots em SQLite que alimentam as telas nativas. O painel `codex-ig.js` (pronto) é injetado no webview do IG como overlay das ações de growth.

**Tech Stack:** Tauri 2 (`@tauri-apps/cli@2.11.x`) · Rust 1.95 (`reqwest`, `rusqlite`/`tauri-plugin-sql`, `serde`, `tokio`, `keyring`) · React 19 + Vite + TypeScript + Tailwind v4 · WebView2 (Windows).

## Global Constraints

- **Identidade Codex Arena** (verbatim): `--void #0b0e17`, `--teal #00e5c9`, `--coral #ff4d3d`, `--paper #e8e4dc`; fonte display Space Grotesk. Zero emoji em UI de produto (SVG/texto).
- **Segurança:** segredos (chaves do tracker) no **keychain do SO** (`keyring`), nunca localStorage/plaintext, nunca no repo. Sem exposição estilo `NEXT_PUBLIC`: segredo só no lado Rust. `.env` no `.gitignore`.
- **Anti-ban:** leitura paginada 550-700ms/página + back-off no 429; escrita (unfollow) ritmada (delay+jitter, lote+pausa, editável), medidor de risco, auto-stop em 429/400, guarda de whitelist. Defaults ~150/dia, 30-60s/ação.
- **Endpoints do IG isolados** num único módulo Rust (`ig_api.rs`), versionável — IG muda a API interna sem avisar.
- **Código FORA do Drive** (já: `D:\Projetos do Claude\Codex-IG-Desktop`). **Build de release só com OK explícito do Paulo** — o spike e o `tauri dev` são desenvolvimento, liberados.
- **x-ig-app-id público** = `936619743392459`. Cookies `ds_user_id` + `csrftoken` lidos em runtime, nunca persistidos por nós.

---

## FASE 0 — SPIKE (make-or-break, roda ANTES de qualquer tela)

**Objetivo:** provar que Tauri 2 consegue (a) abrir um webview no instagram.com, (b) injetar um init-script, e (c) o Rust ler o cookie de sessão do WebView2 e fazer **uma** chamada `i/api/v1` autenticada que retorna o número de "seguindo" do próprio usuário. Se passar, o Motor B é viável e as Fases 1-5 seguem. Se falhar (Rust não acessa o cookie), cai no plano B (painel injetado faz a chamada e manda pro Rust via IPC).

### Task 0.1: Scaffold mínimo Tauri + webview no Instagram

**Files:**
- Create: `spike/` (projeto Tauri isolado, descartável — não é o app final)

- [ ] **Step 1: Scaffold**

```bash
cd "D:/Projetos do Claude/Codex-IG-Desktop"
npm create tauri-app@latest spike -- --template vanilla-ts --manager npm --yes
cd spike && npm install
```

- [ ] **Step 2: Configurar 2 webviews** — editar `spike/src-tauri/src/lib.rs` (ou `main.rs`) pra criar, no `setup`, um `WebviewWindow` (UI) e um segundo webview navegando pra `https://www.instagram.com/` com `initialization_script`.

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

tauri::Builder::default()
  .setup(|app| {
    WebviewWindowBuilder::new(app, "ig", WebviewUrl::External("https://www.instagram.com/".parse().unwrap()))
      .title("Codex IG — Instagram")
      .initialization_script("window.__CODEX_SPIKE__ = true; console.log('[codex] init-script injetado');")
      .inner_size(1100.0, 800.0)
      .build()?;
    Ok(())
  })
  .run(tauri::generate_context!())
  .expect("erro ao rodar");
```

- [ ] **Step 3: Rodar em dev e logar manualmente**

Run: `npm run tauri dev`
Expected: abre a janela do Instagram; o Paulo loga; o console do webview mostra `[codex] init-script injetado` → prova (a) e (b).

### Task 0.2: Rust lê o cookie de sessão + chamada autenticada

**Files:**
- Modify: `spike/src-tauri/src/lib.rs`
- Modify: `spike/src-tauri/Cargo.toml` (deps `reqwest` blocking+json, `tokio`)

**Interfaces:**
- Produces: comando Tauri `spike_following_count() -> Result<u64, String>` — lê cookie do webview "ig", chama a API, devolve a contagem.

- [ ] **Step 1: Deps**

```bash
cd spike/src-tauri
cargo add reqwest --features json,cookies,blocking
cargo add tokio --features full
```

- [ ] **Step 2: Ler cookie do WebView2** — tentar `webview.cookies_for_url("https://www.instagram.com".parse()?)` (Tauri 2 expõe leitura de cookies do webview). Extrair `ds_user_id` e `csrftoken`.

```rust
#[tauri::command]
async fn spike_following_count(app: tauri::AppHandle) -> Result<u64, String> {
  use tauri::Manager;
  let wv = app.get_webview_window("ig").ok_or("webview ig nao existe")?;
  let cookies = wv.cookies().map_err(|e| e.to_string())?;
  let mut ds = String::new();
  let mut csrf = String::new();
  for c in cookies {
    match c.name() { "ds_user_id" => ds = c.value().into(), "csrftoken" => csrf = c.value().into(), _ => {} }
  }
  if ds.is_empty() { return Err("sem ds_user_id — faca login no Instagram".into()); }
  let cookie_hdr = format!("ds_user_id={ds}; csrftoken={csrf}");
  let url = format!("https://www.instagram.com/api/v1/friendships/{ds}/following/?count=1");
  let cli = reqwest::Client::new();
  let r = cli.get(&url)
    .header("x-ig-app-id", "936619743392459")
    .header("x-csrftoken", &csrf)
    .header("cookie", cookie_hdr)
    .header("user-agent", "Mozilla/5.0")
    .send().await.map_err(|e| e.to_string())?;
  if !r.status().is_success() { return Err(format!("HTTP {}", r.status())); }
  // a contagem total nao vem nesse endpoint; provar autenticacao = recebeu "users" sem 401
  let j: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
  Ok(j["users"].as_array().map(|a| a.len() as u64).unwrap_or(0))
}
```

- [ ] **Step 3: Botão na UI** que chama o comando e mostra o resultado (prova (c)).

- [ ] **Step 4: Critério de sucesso**

Run: `npm run tauri dev` → logar no IG → clicar o botão.
Expected: retorna ≥0 sem 401 (autenticou com a sessão). **PASSA** → Motor B viável. **401/erro de cookie** → registrar e ir pro plano B (IPC do painel injetado).

- [ ] **Step 5: Registrar o resultado do spike** em `docs/superpowers/plans/spike-result.md` (passou/falhou, qual caminho de cookie funcionou) e commit.

> ⚠️ **GATE:** só seguir pra Fase 1 depois do spike PASSAR (ou o plano B estar definido). Reportar ao Paulo.

---

## FASE 1 — Fundação (após spike)

### Task 1.1: Scaffold do app final (Tauri 2 + React + Vite + TS + Tailwind v4)
**Files:** Create `app/` (React+Vite+TS via `npm create tauri-app` template react-ts) · `app/src/index.css` (tokens Codex Arena) · `app/tailwind.config` (v4 via `@tailwindcss/vite`).
**Deliverable:** janela abre com o shell Codex Arena (sidebar: Instagram/Relatório/Cliques/Config) — telas vazias. Rodar `tauri dev`, medir DOM (sidebar não colide), screenshot via agent-browser.

### Task 1.2: SQLite + migrações
**Files:** `app/src-tauri` add `tauri-plugin-sql` (sqlite) · `app/src-tauri/migrations/0001_init.sql` (tabelas do §5 do spec: account, snapshot, whitelist, unfollow_log, post_metric, tracker_link).
**Interfaces:** Produces schema. **Deliverable:** app cria o .db no `app_data_dir`; teste: inserir+ler 1 account.

### Task 1.3: Módulo `ig_api.rs` (leitura paginada + pacing)
**Files:** `app/src-tauri/src/ig_api.rs` · testes `app/src-tauri/src/ig_api_tests.rs`.
**Interfaces:** Produces `session_from_webview(app) -> Session{ds,csrf}` · `following(session) -> Vec<IgUser>` · `followers(session) -> Vec<IgUser>` · `feed(session, count) -> Vec<Post>` · `destroy(session, pk) -> Result<()>`. Pacing 550-700ms/página, back-off 429, headers corretos.
**Deliverable:** teste unitário do set-diff (following − followers = não-seguem-de-volta) com dados mockados; e um teste de integração manual (sessão real) logando a contagem.

## FASE 2 — Tela Instagram (webview + painel injetado)
### Task 2.1: Webview do IG + injeção do `codex-ig.js`
**Files:** `app/src-tauri/src/lib.rs` (init-script lê o `codex-ig.js` de `app/resources/codex-ig.js`, copiado do repo showcase) · `app/resources/codex-ig.js`.
**Deliverable:** logar no IG dentro do app, o painel Codex Arena aparece; medir que não colide (agent-browser).
### Task 2.2: Unfollow ritmado via Rust
**Files:** `app/src-tauri/src/growth.rs` (comando `unfollow_batch(pks, delay, batch, pause)` usando `ig_api::destroy` com jitter, auto-stop 429/400, guarda whitelist do SQLite) · UI de controle na tela.
**Deliverable:** rodar contra a conta real com cap baixo (ex.: 3) e provar que deu unfollow + parou/logou; medidor de risco reflete os params.

## FASE 3 — Relatório (nativo)
### Task 3.1: Snapshot + crescimento
**Files:** `app/src-tauri/src/report.rs` (comando `take_snapshot(account)` grava counts+listas; `growth_series(account)` lê histórico) · `app/src/screens/Relatorio.tsx` (gráfico sparkline/linha).
**Deliverable:** 2+ snapshots → gráfico de crescimento + delta; quem-saiu/chegou (set-diff entre snapshots).
### Task 3.2: Engajamento + top posts + melhor horário
**Files:** `report.rs` (`engagement(account)` do post_metric: média likes/coments, taxa; `top_posts`; `best_hour` heurística) · UI cards estilo Viralizai.
**Deliverable:** feed real → média de engajamento, top 5 posts (likes/coments/views), melhor horário rotulado "amostra pequena". Card "Conectar Instagram" desativado (v2) pra reach/demografia.

## FASE 4 — Cliques (tracker nativo)
### Task 4.1: Tela nativa do tracker
**Files:** `app/src/screens/Cliques.tsx` · `app/src-tauri/src/tracker.rs` (fetch ao worker `SEU-WORKER.workers.dev`; chaves lidas do `keyring`, NÃO do front).
**Deliverable:** criar link + ver gráfico de cliques dentro do app (origem nativa = sem CSP); chaves no keychain.

## FASE 5 — Config
### Task 5.1: Conta + whitelist + export CSV
**Files:** `app/src/screens/Config.tsx` · `app/src-tauri/src/config.rs` (`add_account`, `list_whitelist`, `export_csv(report|clicks)`).
**Deliverable:** adicionar/ver a conta logada; ver/editar whitelist; exportar relatório e cliques pra .csv. (Agendador + multi-conta completa + Graph = v2.)

---

## Distribuição (só com OK do Paulo)
`tauri build` → instalador NSIS → GitHub Release. Updater `latest.json` sem BOM (heredoc Bash). Não passa por loja.

## Self-review
- Cobertura do spec: §3 arquitetura→Fase0+1.3+2.1; §4 telas→Fases 2-5; §5 dados→1.2; §6 anti-ban→1.3+2.2; §7 segurança→Global+4.1; §8/§9 escopo v1→Fases 2-5 (v2 explicitamente fora); §11 testes→agent-browser+unit; §12 spike→Fase 0. Sem lacunas no v1.
- Placeholders: nenhum "TBD"; Fases 1-5 são tarefas estruturadas (files+interfaces+deliverable) a expandir em micro-passos DEPOIS do spike travar a arquitetura — decisão consciente (YAGNI), não placeholder.
- Tipos: `Session{ds,csrf}`, `IgUser`, `Post`, `destroy(session,pk)` consistentes entre 1.3/2.2/3.x.
