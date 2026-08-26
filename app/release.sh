#!/usr/bin/env bash
# Build assinado do Codex IG. Le a updater key do arquivo (fora do repo) e exporta
# a env SO pra este processo -> tauri build assina o updater artifact sozinho.
# A key NUNCA fica no repo nem no registro do Windows; vive so no arquivo abaixo.
set -euo pipefail

KEY_FILE="${TAURI_KEY_FILE:-/c/Users/paulo/Documents/API KEY CLAUDE CODE/codex-ig-updater-v2-NOVA-5CFA266F.key}"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERRO: key nao encontrada em: $KEY_FILE" >&2
  echo "Ajuste o caminho ou exporte TAURI_KEY_FILE=<caminho>." >&2
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

cd "$(dirname "$0")"
echo "Assinatura: ON (key carregada do arquivo, nao persistida)"
npm run tauri build "$@"
