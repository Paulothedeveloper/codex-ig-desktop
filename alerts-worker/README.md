# Codex Alerts — monitor 24/7 de menções

Worker do Cloudflare que, sozinho, a cada 30 minutos: busca os nomes que você monitora (últimas 24h), a IA lê e separa o que é **ataque/mentira**, e te manda um **e-mail** só quando aparece algo negativo novo. É o "alerta de crise" do war room, rodando sem você abrir o app.

Provado funcionando: a busca (Serper), a leitura por IA (Groq, `gpt-oss-120b`) e o envio (Resend) já foram testados de ponta a ponta.

## O que você precisa (uma vez)
- Conta no **Cloudflare** (grátis) — https://dash.cloudflare.com
- As 3 chaves que o app já usa: **Serper**, **Groq**, **Resend** (estão na sua pasta `Documents/API KEY CLAUDE CODE`).

## Passo a passo (leigo)

1. **Instalar a ferramenta** (uma vez). Abra o PowerShell e rode:
   ```
   npm install -g wrangler
   wrangler login
   ```
   (abre o navegador → clique **Allow**.)

2. **Criar a “memória” do worker (KV).** No PowerShell, dentro da pasta `alerts-worker`:
   ```
   wrangler kv namespace create SEEN
   ```
   Ele imprime um `id = "..."`. **Copie esse id** e cole no `wrangler.toml` no lugar de `COLOQUE_O_ID_DO_KV_AQUI`.

3. **Configurar quem monitorar e pra quem mandar.** Abra `wrangler.toml` e edite:
   - `TERMS` = os nomes/temas (ex: `Adailton Fúria, Marcos Rogério, Hildo`).
   - `ALERT_TO` = seu e-mail.
   - `ALERT_FROM` = deixe `onboarding@resend.dev` só pra testar (ver passo 6).

4. **Guardar as chaves secretas** (não vão pro arquivo, ficam seguras na Cloudflare). Rode uma por uma e cole o valor quando pedir:
   ```
   wrangler secret put SERPER_KEY
   wrangler secret put GROQ_KEY
   wrangler secret put RESEND_KEY
   wrangler secret put CRON_SECRET
   ```
   (No `CRON_SECRET` invente uma senha qualquer — serve pra você disparar um teste manual.)

5. **Publicar:**
   ```
   wrangler deploy
   ```
   Pronto — o worker passa a rodar sozinho a cada 30 min. Pra testar na hora, abra no navegador:
   `https://codex-alerts.SEU-SUBDOMINIO.workers.dev/run?key=SUA_CRON_SECRET`

6. **Para mandar e-mail pra qualquer endereço** (não só o seu): no Resend (https://resend.com/domains) **verifique um domínio** (ex: `paulocodex.com`) e troque o `ALERT_FROM` pra algo como `Codex Alerts <alertas@paulocodex.com>`. Enquanto não verificar, o Resend só entrega pro e-mail dono da conta (limite do modo teste).

## Custo
- Cloudflare Workers + Cron + KV: **grátis** no plano free (folga enorme pra 30 em 30 min).
- Serper/Groq/Resend: dentro dos tiers grátis pra esse volume.

## Como funciona (resumo técnico)
`src/worker.js` → `scheduled` (cron) chama `runOnce`: Serper `qdr:d` por termo → filtra links **novos** (KV `SEEN`, TTL 7 dias) → Groq classifica sentimento → junta os **negativos** → Resend manda 1 e-mail agrupado por termo. Sem link novo ou sem negativo = não manda nada (zero spam).
