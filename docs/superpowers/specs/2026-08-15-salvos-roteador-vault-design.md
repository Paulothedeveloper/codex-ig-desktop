# Salvos → Roteador de conhecimento (vault) — design

Data: 2026-08-15 · Projeto: Codex IG Desktop · Autor: Paulo (via Claude)

## Problema

Paulo salva MUITA coisa no Instagram (reels de DaVinci/edição, concurso público,
ideias de audiovisual, negócio…). Quer que esses salvos **alimentem
automaticamente** os vaults de conhecimento (`G:\Meu Drive\VAULTS\...`), cada tema
no vault certo — sem trabalho manual de "me manda a URL".

## A virada que simplifica

O **Quartzo não precisa acessar o IG** — ele só abre os `.md`. Quem acessa é um
**coletor**. E o coletor faz SÓ o que exige a sessão logada: **a lista dos Salvos**.
Frames, transcrição, classificação de tema, roteamento e escrita da nota são o passo
de **absorção pela IA** (Claude, com a skill `transcribe-video-url` + raciocínio).

Divisão (ponytail):

- **App (Codex IG)** = harvest. Lista autenticada dos salvos → grava fila no vault.
  Reusa o motor `webview_fetch` (fetch dentro da janela logada, zero-block, trata
  rate-limit) já provado em friendships/feed/likers.
- **IA (Claude)** = absorção. Lê a fila → decide tema → roteia pro vault EXISTENTE que
  melhor encaixa → escreve a nota (formato Obsidian) → atualiza índice/busca burra →
  marca processado → commit.

## Roteamento — a inteligência

Regra do Paulo (verbatim): *"se um tema se enquadra num outro, o vault deve ser o
mesmo — colorgrading → DaVinci; plugin de edição → DaVinci. Tem que ser inteligente e
saber onde encaixar SEM ficar criando um monte de vault pra qualquer coisa."*

- **Modo geral primeiro**: a IA classifica pelo conteúdo (frames + legenda). O modo
  "coleção IG = tema" fica como toggle (alternável quando o Paulo quiser).
- **Encaixe semântico em vault EXISTENTE primeiro.** A IA olha os vaults que existem em
  `G:\VAULTS` (cada um tem Home/tema) e decide onde o reel **pertence**. Viés forte a
  reusar. DaVinci é guarda-chuva de: cor/colorgrading, edição, Fusion, áudio,
  audiovisual, plugins de edição.
- **Vault novo só quando NADA existente serve** (domínio genuinamente novo). Órfão
  solitário → vira nota num guarda-chuva `_INBOX-SALVOS` com tag do tema; promove a
  vault próprio quando juntar um cluster real (~4+). Anti-explosão de vaults.

## Dados / estado (sem banco — escala pequena)

- Inbox: `G:\Meu Drive\VAULTS\_INBOX-SALVOS\`
  - `_A-PROCESSAR.jsonl` — fila; 1 item/linha:
    `{code, media_id, url, is_video, caption, thumb, taken_at, collection, added_at}`
  - `_FILA-ESTADO.json` — `{seen:[shortcodes]}` pra dedup (não re-enfileira o que já entrou).
  - `_ROTEADOR.md` — regras de roteamento (pra qualquer sessão absorver igual).

## App — comandos novos

- `ig_saved()` → Vec<SavedItem> (todos os salvos, paginado `/api/v1/feed/saved/posts/`).
- `ig_collections()` → `[{id,name,count}]` (`/api/v1/collections/list/`) — pro toggle.
- `ig_collection(id)` → Vec<SavedItem> (`/api/v1/feed/collection/{id}/posts/`).
- `write_bytes` ganha `create_dir_all` no pai (inbox pode não existir ainda).

`SavedItem { code, media_id, is_video, thumb, caption, taken_at, collection }`.

## App — UI (aba "Salvos")

- Botão **Puxar salvos** (ou coleção via dropdown, toggle geral/coleção).
- Lista com miniatura + legenda + tema-da-coleção.
- Botão **Enviar novos pra fila do vault** → dedup vs `_FILA-ESTADO.json` → append no
  `.jsonl` → atualiza estado. Mostra "N novos enfileirados".
- Keep-mounted (`hidden`, não desmonta) + i18n 5 idiomas + zero emoji (regras do Manual).

## Anti-block (lição de julho)

- Só a coleção/salvos (volume baixo), ritmo com jitter (motor já ritma), método via
  janela logada (não download de API cru — yt-dlp levava soft-block a cada ~4).
- A absorção (frames/transcrição) é ritmada e best-effort; sem frame → cai pra
  legenda + capa (o suficiente pra rotear e registrar a ideia).

## Fora de escopo (v1)

- App escrever a receita sozinho via LLM (Groq já existe no app) — qualidade pior;
  upgrade futuro se quiser 100% sem sessão do Claude.
- Agendador full-auto (Task Scheduler → headless): trivial de acrescentar depois
  embrulhando `ig_saved` num run agendado; v1 é 1-clique.

## Prova

- App: compila (tsc + cargo check). Live (listar salvos reais) = precisa da sessão do
  Paulo — padrão de toda feature do Codex IG.
- Absorção: rodo na fila e mostro as notas escritas nos vaults certos.
