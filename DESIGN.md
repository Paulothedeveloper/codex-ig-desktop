# Codex IG Desktop — DESIGN

Identidade **Codex Arena** (mesma do tool/tracker/Paulocodex). Kit em [`brand/`](brand/) (+ vault `G:\Meu Drive\VAULTS\PC - CODEX IG\Identidade-Visual`).

## Marca
Símbolo **"orbit"** (mark novo, direção do Paulo): arco de momentum teal subindo até um ponto coral com glow = *crescimento chegando no pico*. Fonte = SVG vetor (`brand/codex-ig-icon.svg` app icon, `brand/codex-ig-mark.svg` mark transparente). Icon set gerado via `tauri icon`.

## Paleta (tokens em `app/src/index.css`)
- **Deep Void** `#0b0e17` (fundo) · painel `#0d1420` · gradiente ícone `#0e1420→#090d14`
- **Electric Teal** `#00e5c9` (primária) · `#0aa892` (dim) · `#7ef7e6` (claro)
- **Burnt Coral** `#ff4d3d` (accent) · `#ff8a5c` (highlight)
- **Warm Ash** `#e8e4dc` (texto) · **Slate** `#8892a0` (secundário) · linha `#1b2536` · steel `#232c3b`

## Tipografia
**Space Grotesk** (display + corpo) — **self-hosted** via `@fontsource/space-grotesk` (woff2, pesos 400/500/600/700). Nada de `<link>` do Google (regra do Manual).

## Componentes / layout
Shell: sidebar 240px (logo orbit + wordmark gradiente + 4 abas com ícone SVG + estado ativo teal gradiente) + área principal com header sticky. Cards `rounded-2xl` borda `--line` fundo `--panel`. Botão primário = gradiente teal; perigo = gradiente coral. Aurora sutil de fundo (respeita `prefers-reduced-motion`).

## Regras aplicadas (Manual)
- **ZERO emoji em UI** → tudo SVG (`app/src/icons.tsx`, dicionário `ICON` + `<Ic>`). Provado por varredura regex no DOM = `[]`.
- **a11y WCAG:** `:focus-visible` outline teal, `aria-label` em botões só-ícone e inputs. *(Falta: medir contraste/foco com leitor de tela + tamanho de alvo ≥44px — pendente.)*
- **Layout medido** (chromium 1180×760): 0 colisão, 0 overflow nas 4 abas.
- Motion só transform/opacity, reduced-motion respeitado.

## Pendências de design
Contraste/alvo a11y medidos com ferramenta · estados de erro humanizados · embutir a janela do IG (hoje é janela separada) · i18n (hoje só PT-BR).
