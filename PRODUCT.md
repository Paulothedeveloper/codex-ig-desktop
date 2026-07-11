# Codex IG Desktop — PRODUCT

**O que é:** app desktop (Windows-first, Tauri 2) pra gerenciar crescimento, métricas e cliques de link do **próprio** Instagram do Paulo, rodando a **sessão real logada** dele. Uso pessoal.

**Para quem:** o Paulo (e, se virar produto, criadores que querem growth/analytics local e privado, sem entregar a conta pra farm de terceiro).

**A restrição que molda tudo (honesto):** a Graph API oficial **não lista seguidores** — só a sessão web dá. Todo tool que dependeu da API oficial morreu; todo que abusou de escrita foi banido. Logo: **muito-leitura, escrita-ritmada, snapshot-diff, na sessão real**. Não é bot de login (bane), não passa por loja (reprova automação de IG) → **download direto** (GitHub Release).

## Features (v1 — entregue)
- **Instagram:** *Limpar* (unfollow ritmado de quem não retribui, whitelist, medidor de risco, para no bloqueio) + *Alvos* (seguidores de concorrentes = público).
- **Relatório:** seguindo/seguidores/não-retribuem/mútuos/fãs + engajamento/top posts + **crescimento no tempo (SQLite)** + quem-saiu + melhor horário.
- **Cliques:** tracker de link da bio (worker próprio), contagem por link.
- **Config:** conta, whitelist (export CSV), abrir janela do Instagram, privacidade.

## Não-objetivos
Login por senha (bane) · loja (reprova) · "quem viu teu perfil" (golpe) · fake-follower score (dados pagos) · automação 24/7 na nuvem (servidor) · auto-DM (maior risco de ban).

## Roadmap (v2)
Conectar Instagram (Graph → reach/impressões/demografia) · agendador + tray · multi-conta · ideias-de-conteúdo-por-nicho (ref. Viralizai, precisa servidor) · updater Tauri (latest.json) · assinatura do instalador (tira SmartScreen).

## Segurança & privacidade
Local, sessão do usuário, cookies lidos em runtime nunca gravados, SQLite no aparelho, zero PII, sem servidor de terceiro. Passa o [checklist baseline]. Instalador não-assinado (SmartScreen — sideload pessoal).

Spec/plano completos: [`docs/superpowers/`](docs/superpowers/).
