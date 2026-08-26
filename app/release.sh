#!/usr/bin/env bash
# Build assinado do Codex IG. Le a updater key de um arquivo LOCAL (fora do repo) e
# exporta a env SO pra este processo -> tauri build assina o updater artifact sozinho.
# A key NUNCA fica no repo nem no registro do Windows.
#
# Onde fica o caminho da key (nesta ordem):
#   1) env TAURI_KEY_FILE
#   2) arquivo local gitignored: app/.sign-key-path (uma linha com o caminho)
# Ambos ficam FORA do controle de versao (nenhum caminho pessoal no repo publico).
set -euo pipefail
cd "$(dirname "$0")"

KEY_FILE="${TAURI_KEY_FILE:-}"
if [[ -z "$KEY_FILE" && -f .sign-key-path ]]; then
  KEY_FILE="$(head -n1 .sign-key-path)"
fi

if [[ -z "$KEY_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "ERRO: caminho da updater key nao configurado." >&2
  echo "Faca UMA das opcoes:" >&2
  echo "  - export TAURI_KEY_FILE=/caminho/para/updater.key" >&2
  echo "  - crie app/.sign-key-path com o caminho da key na 1a linha (gitignored)" >&2
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

echo "Assinatura: ON (key carregada do arquivo local, nao persistida)"
npm run tauri build "$@"
