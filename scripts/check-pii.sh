#!/usr/bin/env bash
# ============================================================================
#  TRAVA DE SEGURANCA PRE-COMMIT/PUSH/DEPLOY  (Codex IG — repo publico)
#  Bloqueia (a) SEGREDO e (b) DADO PESSOAL do dev antes de entrar no repo.
#  Roda no pre-commit (local, .githooks) e na CI (GitHub Actions).
#  git grep = so arquivos VERSIONADOS. Sai 1 (falha) se achar qualquer coisa.
#  Contato PUBLICO permitido: contato@paulocodex.com.
# ============================================================================
set -u
EXCLUDES=(":!*.lock" ":!scripts/check-pii.sh" ":!.github/workflows/security-pii.yml")
fail=0

# (a) SEGREDOS — chave privada, API keys, tokens. NUNCA no repo (nem publico nem privado).
SECRETS='-----BEGIN (RSA|OPENSSH|EC|PRIVATE)|untrusted comment: minisign (secret|encrypted secret) key|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN PGP PRIVATE'
if git grep -nIE -e "$SECRETS" -- "${EXCLUDES[@]}" 1>&2; then
  echo ">> SEGREDO acima. Remova (use env/secret do CI, nunca no git)." 1>&2; fail=1
fi

# (b) DADO PESSOAL do dev — path do usuario, drive pessoal, pasta de chaves, email pessoal/@gmail.
PII='C:[\\/]Users[\\/]paulo|Meu Drive|G:[\\/]VAULTS|Documents[\\/].*API KEY|paulobatista[0-9]*@|[A-Za-z0-9._%+-]+@gmail\.com'
if git grep -nIE -e "$PII" -- "${EXCLUDES[@]}" 1>&2; then
  echo ">> DADO PESSOAL acima. Use env CODEXIG_VAULTS / CODEXIG_KEYS_DIR ou caminho generico." 1>&2; fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "" 1>&2
  echo "==================================================================" 1>&2
  echo " BLOQUEADO: seguranca. Corrija o acima antes de commitar/push/deploy." 1>&2
  echo "==================================================================" 1>&2
  exit 1
fi
echo "check-seguranca: LIMPO (sem segredo nem dado pessoal do dev no repo)."
exit 0
