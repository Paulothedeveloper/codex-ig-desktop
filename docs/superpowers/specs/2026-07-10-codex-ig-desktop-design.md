# Codex IG Desktop — Design Spec

**Data:** 2026-07-10 · **Autor:** Claude (Opus 4.8) + Paulo · **Status:** rascunho para revisão do Paulo

Sub-projeto 1 do plano híbrido. Sub-projeto 2 ("Codex Links", produto vendável de link-in-bio + analytics) terá spec próprio.

---

## 1. Propósito

App **desktop** (PC, Windows-first) para o Paulo gerenciar o crescimento, as métricas e os cliques de link do **próprio** Instagram, rodando a **sessão real logada** dele — sem bot de login, sem loja. Uso pessoal.

**A restrição que molda tudo (provado por pesquisa 2026):** a **Graph API oficial NÃO lista seguidores** — só a sessão web dá ([keyapi.ai](https://www.keyapi.ai/blog/instagram-graph-api-get-followers-list-following/)). Todo concorrente que dependeu da API oficial morreu (Crowdfire, ManageFlitter); todo que abusou de escrita foi banido pela Instagram (Combin). Os sobreviventes (FollowMeter, Reports+, Social Blade, Not Just Analytics) são **muito-leitura, pouca-escrita, snapshot-diff, na sessão real do usuário**. Esse é o nosso desenho.

## 2. Não-objetivos (cortes honestos de escopo)

- **Não** loga no Instagram com usuário/senha (instagrapi-style) — bane a conta, fere o ToS.
- **Não** distribui por Play/App Store — reprova app que automatiza Instagram. Distribuição = download direto (GitHub Releases), como PRISMA/Ludex/Quartzo.
- **Não** faz "quem viu teu perfil" — impossível para qualquer API; todo app que promete, mente.
- **Não** faz score de fake-follower estilo HypeAuditor — precisa de dados pagos + ML.
- **Não** faz automação 24/7 na nuvem — precisa de servidor + proxies.
- **Não** faz auto-DM no v1 — é a rota mais rápida pra spam-block.

## 3. Arquitetura (Motor B)

Stack: **Tauri 2** (Rust + WebView2 no Windows) + **React + Vite + Tailwind v4** no front, identidade **Codex Arena** (`#0b0e17` / `#00e5c9` / `#ff4d3d`, Space Grotesk). Reusa o stack que o Paulo já shippa (PRISMA/Ludex/Quartzo).

Dois webviews:
- **UI do app** (origem nossa, `tauri://localhost`): sidebar + telas nativas.
- **Webview filho → instagram.com**: o Paulo loga normal; é a sessão real dele.

**Motor em Rust (o núcleo):**
1. Lê os cookies de sessão do WebView2 (`ds_user_id`, `csrftoken`) do webview do Instagram.
2. Chama a **API web interna do IG** via `reqwest` (mesmos endpoints `i/api/v1/...` que o site usa, com `x-ig-app-id` público + cookies), **paginado, ritmado, cacheado**.
3. Grava snapshots + métricas em **SQLite** local.
4. Alimenta as telas nativas e o agendador (v2).

O **painel injetado** (`codex-ig.js`, já pronto) roda dentro do webview do IG via `initialization_script` — é o overlay pras ações de growth em contexto (unfollow/alvos). O motor Rust é a fonte de verdade; o painel é conveniência.

*O padrão "daemon Rust segura sessão autenticada + injeta init-script" está provado pelo `vercel-labs/agent-browser` (CDP + `--init-script` + profile persistente) — de-risca o motor B.*

## 4. Telas (Codex Arena, sidebar à esquerda)

1. **Instagram** — webview logado + painel injetado (unfollow livre/ritmado com medidor de risco, alvos, whitelist, snapshot).
2. **Relatório** — nativo, dashboard estilo **Viralizai** (referência do mercado): crescimento de seguidores no tempo (gráfico, SQLite), taxa de engajamento, top posts (likes/coments/views), melhor horário (heurística honesta), razão seg./seguidores, quem-deixou-de-seguir / novos. **Reach + demografia (idade) ficam num card "Conectar Instagram" desativado** → v2 (só saem da Graph API).
3. **Cliques** — nativo: gerencia o tracker (criar link, gráfico de cliques por dia). Fala com o **Cloudflare Worker já deployado** direto (origem nossa = sem a trava CSP que existe dentro do Instagram).
4. **Config** — contas (multi-conta: estrutura pronta, troca completa no v2), whitelist, **export CSV**, (agendador → v2).

## 5. Modelo de dados (SQLite — database-first)

- `account(id, ig_user_id, username, added_at)`
- `snapshot(id, account_id, ts, following_count, followers_count, followers_json, following_json)` — contagens pro gráfico de crescimento; os JSON de pks pro diff "quem saiu / quem chegou".
- `whitelist(account_id, pk, username)` — protegidos da limpeza.
- `unfollow_log(account_id, pk, username, ts, result)` — auditoria das ações de escrita.
- `post_metric(account_id, code, taken_at, likes, comments, views, caption, fetched_at)` — cache do feed pro Relatório.
- `tracker_link(account_id, slug, url, created_at)` — espelho local opcional do tracker.

Escala = milhares de linhas por conta → SQLite é folgado. Índices em `(account_id, ts)` e `(account_id, pk)`.

## 6. Motor anti-ban (limites reais 2026)

- **Leitura (baixo risco):** paginação lenta (550-700ms/página), cache, back-off no 429. Ler lista de seguidores/seguindo, feed próprio, seguidores de concorrente **público** (amostra pequena).
- **Escrita (alto risco — opt-in, avisado):** unfollow/follow ritmados (delay+jitter, lote+pausa, tudo editável), **medidor de risco honesto**, **auto-stop em 429/400**, guarda de whitelist. Defaults dentro do observado seguro (~150/dia, 1 ação a cada 30-60s) ([limites 2026](https://feedflux.app/blog/instagram-follow-unfollow-limits-2026)).
- **Nunca** burst; imita o cliente web real (headers corretos).

## 7. Segurança (aplicando o vídeo de LGPD/cybersegurança)

- Chaves do tracker e qualquer segredo → **keychain do SO** (Tauri stronghold/keyring), **nunca** localStorage em texto puro, **nunca** no repo.
- **Zero segredo no bundle do front** (sem exposição estilo `NEXT_PUBLIC`): segredos moram no lado Rust.
- `.env` no `.gitignore`; nada sensível commitado (secret-scan + Dependabot).
- Cookies de sessão do IG: lidos em runtime do WebView2, **nunca** persistidos por nós além do store do próprio webview.
- Dados do usuário ficam **locais** (SQLite no aparelho). LGPD: é o dado do próprio Paulo, local — sem servidor de terceiro.

## 8. Posicionamento competitivo (do teardown + Viralizai)

Iguala **FollowMeter + Reports+ + Social Blade + Not Just Analytics + Phlanx** — só que **pra tua própria conta, local, grátis e privado** (sem entregar a conta pra farm de ninguém). Referência direta = **Viralizai** (dashboard: frequência, melhor dia, novos seguidores/dia, alcance/dia, idade dos seguidores + ideias de conteúdo por nicho). Reach/idade = Graph (v2). Rótulos honestos (views ≠ reach). Menor detecção do mercado (sessão real, sem phishing/farm) — mas "menor" não é "zero"; leitura-primeiro, escrita opt-in avisada.

## 9. Escopo: v1 vs v2

**v1 (entregar rápido — recomendação de corte):**
- Tela Instagram (unfollow ritmado + alvos + whitelist, painel injetado).
- Relatório nativo local: crescimento, engajamento, top posts, melhor horário, razão, quem-saiu/chegou.
- Cliques nativo (tracker que já está no ar).
- Config: adicionar 1 conta, whitelist, export CSV.
- SQLite + segurança + motor Rust + distribuição por download.

**v2 (depois):**
- Agendador + system tray (snapshot diário + aviso de unfollow relevante com app minimizado).
- Multi-conta completa (troca de sessão).
- **Conectar Instagram (Graph API)** → reach, impressões, demografia (idade dos seguidores estilo Viralizai).
- **Ideias de conteúdo por nicho** (feature-matadora do Viralizai) → precisa de servidor + scraping de virais por nicho (infra pesada; não local). Provável produto/serviço à parte.
- Auto-DM: talvez nunca (maior risco de ban).

## 10. Distribuição

Download direto via **GitHub Releases** (instalador NSIS/MSI), como PRISMA/Ludex. **Tauri updater** (`latest.json` sem BOM — gerar por heredoc Bash, não PowerShell). Não passa por loja.

## 11. Testes / prova

- **Harness = `agent-browser`** (recém-instalado): dirige o instagram.com logado (sessão real) pra validar o painel injetado + medir DOM. Substitui o Playwright-Firefox onde couber.
- Motor Rust: teste unitário do set-diff (quem-saiu), do pacing, do parser de cookie.
- Provar cada tela rodando (feliz + vazio + erro) antes de "pronto" [exhaustive-qa].

## 12. Riscos & spike obrigatório

- **Spike #1 (passa ANTES de qualquer tela):** Tauri 2 cria webview filho → instagram.com + `initialization_script` injeta um script + **o lado Rust lê o cookie de sessão do WebView2** e faz **uma** chamada `i/api/v1` autenticada. Se isso funcionar, todo o motor B flui. (agent-browser já indica que o padrão é sólido.)
- Risco: IG muda a API interna → isolar todos os endpoints num módulo único, versionado, com fallback claro.
- Risco: WebView2 não expõe o cookie store facilmente ao Rust → fallback = o painel injetado faz as chamadas e manda o resultado pro Rust via IPC (motor A como plano B só pra coleta).

## 13. Questões abertas

- Idioma: **PT-BR** no v1 (EN depois, se virar produto).
- Preço: uso pessoal agora; se productizar, spec de venda à parte (profit-first).

---

### Fontes
[Graph API não lista seguidores](https://www.keyapi.ai/blog/instagram-graph-api-get-followers-list-following/) · [limites follow/unfollow 2026](https://feedflux.app/blog/instagram-follow-unfollow-limits-2026) · [agent-browser](https://github.com/vercel-labs/agent-browser) · teardowns de concorrentes (unfollow/analytics/link-in-bio) na sessão de 2026-07-10.
