# Codex IG — Identidade Visual

**Categoria:** Design-UX / Identidade Visual · **Projeto:** Codex IG Desktop (app de growth/relatório/cliques do Instagram) · **Gerado:** 2026-07-10.

## Marca (o "orbit")
Símbolo **novo** (direção do Paulo: "mark novo, mesma paleta" — não reaproveita o "C" do tool/tracker). Um **arco de momentum teal** subindo até um **ponto coral com glow** = *crescimento chegando no pico / alcance atingido*. Direção nasceu de conceito Grok (`grok-imagine-image-quality`) → **refinado à mão em SVG vetor** (regra do Manual: entregável é vetor, não raster borrado).

## Paleta (Codex Arena — mesma do tool/tracker/Paulocodex)
- **Deep Void** `#0b0e17` (fundo base) · gradiente do ícone `#0e1420 → #090d14`
- **Electric Teal** `#00e5c9` (primária) · `#0aa892` (teal-dim, base do gradiente)
- **Burnt Coral** `#ff4d3d` (accent/pico) · `#ff8a5c` (highlight)
- **Warm Ash** `#e8e4dc` (texto claro) · **Slate** `#8892a0` (secundário) · linha `#1b2536`

## Tipografia
Display: **Space Grotesk** · Body: **Inter**.

## Arquivos (fonte = SVG)
- `codex-ig-icon.svg` — **app icon** (fundo void, cantos arredondados). Fonte do icon set.
- `codex-ig-mark.svg` — **mark-only** (transparente) → header do app + favicon.
- `codex-ig-icon-1024.png` / `codex-ig-mark-1024.png` — raster 1024 (derivado).
- Icon set (`.ico` Windows / `.icns` macOS / PNG 16→1024 + mipmaps Android) gerado via `npx tauri icon codex-ig-icon-1024.png` → `src-tauri/icons/`.

## Regras de uso
- **Zero emoji em UI.** O mark em **SVG é a fonte**; raster só derivado.
- Escala até **16px** (o arco fino interno some em tamanho pequeno — proposital). Fundo sempre **void** ou **transparente**.
- Render SVG→PNG: **Chromium** do Playwright (`omitBackground:true` p/ transparência — Firefox NÃO suporta transparência em screenshot).
- Cascata: window/taskbar icon (`src-tauri/icons`), header do app, favicon, installer. Mesma marca no app real (Fase 1).

## Histórico
- 2026-07-10: 4 conceitos Grok (spark/nós/barras/orbit) → Paulo escolheu **orbit** → 2 refinos vetor (A swoosh+pico / B órbita-anel) → Paulo escolheu **A**. Kit gerado e salvo aqui + em `Codex-IG-Desktop/brand/`.
