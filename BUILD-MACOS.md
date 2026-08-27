# Build do Codex IG no macOS

O app é Tauri (multiplataforma). O Windows sai como `.exe` (NSIS). No **Mac** sai como `.app` + `.dmg`.
Só dá pra gerar o build do Mac **num Mac** (a Apple exige as ferramentas dela). Passo a passo:

## 1. Pré-requisitos (uma vez, no Mac)
1. **Xcode Command Line Tools** — no Terminal:
   ```
   xcode-select --install
   ```
2. **Rust** — https://rustup.rs (cola no Terminal):
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js 20+** — https://nodejs.org (baixa o instalador macOS).
4. Se o Mac for **Apple Silicon (M1/M2/M3)**, adiciona o alvo Intel também (pra gerar universal se quiser):
   ```
   rustup target add x86_64-apple-darwin aarch64-apple-darwin
   ```

## 2. Pegar o código
```
git clone https://github.com/Paulothedeveloper/codex-ig-desktop.git
cd codex-ig-desktop/app
npm ci
```

## 3. Build (gera o .dmg)
```
npm run tauri build -- --bundles app,dmg
```
Saída:
```
src-tauri/target/release/bundle/dmg/Codex IG_0.6.31_aarch64.dmg
src-tauri/target/release/bundle/macos/Codex IG.app
```
(No Apple Silicon o nome sai `aarch64`; no Intel, `x64`. Pra **universal** (roda nos dois):
`npm run tauri build -- --target universal-apple-darwin --bundles app,dmg`.)

## 4. Auto-update assinado (opcional, pra o updater do Mac funcionar)
O updater usa a MESMA chave de assinatura do Windows. No Mac, antes do build:
```
export TAURI_SIGNING_PRIVATE_KEY="$(cat /caminho/para/codex-ig-updater-v2-NOVA-5CFA266F.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build -- --bundles app,dmg
```
Isso gera o `.dmg` + o `.dmg.sig`. Pra o updater servir Mac, o `latest.json` precisa ganhar as plataformas
`darwin-aarch64` / `darwin-x86_64` (hoje só tem `windows-x86_64`) — adicionar quando publicar a 1ª versão Mac.

## 5. Distribuir
- Sem conta Apple Developer: o `.dmg` funciona, mas o Gatekeeper avisa ("app de dev não identificado").
  O usuário abre com **botão direito → Abrir → Abrir** (uma vez) ou Ajustes → Privacidade e Segurança → "Abrir mesmo assim".
- Com conta Apple Developer (US$99/ano): dá pra **assinar (codesign) + notarizar** → abre sem aviso. Precisa do
  Developer ID Application cert. (Fica pra quando valer a pena vender no Mac.)

## Notas
- O `com.paulocodex.codexig` (identifier) e o `icons/icon.icns` já estão prontos pro Mac.
- A janela usa titlebar custom (`decorations: false`) — no Mac os botões de semáforo (vermelho/amarelo/verde)
  não aparecem por padrão; se quiser eles, é um ajuste no `tauri.conf.json` (`"titleBarStyle"`), mas aí perde
  o visual sem-cara-de-SO. Testar no Mac antes de decidir.
- As features que dependem da sessão do Instagram (webview 'ig') funcionam igual (WKWebView no Mac).
