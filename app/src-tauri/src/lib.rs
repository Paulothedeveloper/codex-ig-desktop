// Codex IG Desktop — backend Tauri.
// SQLite (tauri-plugin-sql) + comandos que usam o modulo ig_api (sessao do WebView -> API do IG).
mod ig_api;
use ig_api::{Post, Session};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

async fn sess(app: &tauri::AppHandle) -> Result<Session, String> {
    ig_api::session_from_webview(app).await
}

// Args do WebView2/Chromium (Windows): evita tela branca/preta ao minimizar (occlusion +
// GPUCache) e impede o throttle de timers quando minimizado — o loop de unfollow roda no
// renderer e travaria se a janela fosse pra segundo plano. Regra do Manual (tela-branca + anti-standby).
#[cfg(windows)]
const WV_ARGS: &str = "--disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-gpu-shader-disk-cache";

/// Abre a janela 'ig' (instagram.com) — o Paulo loga aqui; os comandos ig_* leem a sessão dela.
fn open_ig(app: &tauri::AppHandle) -> tauri::Result<()> {
    let b = WebviewWindowBuilder::new(
        app,
        "ig",
        WebviewUrl::External("https://www.instagram.com/".parse().unwrap()),
    )
    .title("Codex IG — Instagram (faça login aqui)")
    .initialization_script("window.__CODEX_IG__=true;")
    .inner_size(1040.0, 800.0);
    #[cfg(windows)]
    let b = b.additional_browser_args(WV_ARGS);
    b.build()?;
    Ok(())
}

/// Escreve bytes num caminho (o JS pega o caminho via diálogo nativo de salvar). Tauri não faz
/// download de browser (a.click/doc.save viram no-op) — export = save-dialog + escrita no Rust.
#[tauri::command]
fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    // cria a pasta pai se faltar (a caixa de entrada _INBOX-SALVOS pode nao existir ainda).
    if let Some(dir) = std::path::Path::new(&path).parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir).map_err(|e| format!("criar pasta {}: {e}", dir.display()))?;
        }
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("escrever {path}: {e}"))
}

/// Le bytes de um caminho (o JS pega via diálogo nativo de abrir). Pra importar PDFs no app.
#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("ler {path}: {e}"))
}

/// Resolve chave de API: prioriza o Config; se vazio, le do arquivo local do Paulo
/// (Documents\API KEY CLAUDE CODE\<file>). Nunca vai pro repo.
fn resolve_key(config: &str, file: &str) -> String {
    let c = config.trim();
    if !c.is_empty() {
        return c.to_string();
    }
    std::env::var("USERPROFILE")
        .ok()
        .map(|h| format!("{h}\\Documents\\API KEY CLAUDE CODE\\{file}"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Busca o conteudo INTEIRO de uma pagina (nao so o snippet) e devolve texto legivel.
/// Precisao: le o artigo/post de verdade pra IA analisar a fundo.
#[tauri::command]
async fn fetch_page(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "url invalida".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("url invalida".into());
    }
    // Anti-SSRF: so host publico. Bloqueia localhost/IP privado/link-local pra pagina
    // maliciosa nos resultados nao sondar a rede local do usuario.
    // ponytail: cobre host literal; DNS-rebind fica fora (Policy::none abaixo corta redirect->interno).
    let host = parsed.host_str().ok_or("url invalida")?.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") {
        return Err("host nao permitido".into());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified(),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
        if blocked {
            return Err("host nao permitido".into());
        }
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let html = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("fetch falhou: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(strip_html(&html, 8000))
}

/// HTML -> texto legivel (sem crate de regex): tira script/style + todas as tags, colapsa espaco.
fn strip_html(html: &str, max: usize) -> String {
    let low = html.to_lowercase();
    // remove blocos script/style pelo texto original usando os indices do lowercase
    let mut cleaned = String::with_capacity(html.len());
    let bytes = html.as_bytes();
    let mut i = 0;
    let drop_block = |tag: &str, from: usize| -> Option<usize> {
        let open = format!("<{tag}");
        if low[from..].starts_with(&open) {
            if let Some(end) = low[from..].find(&format!("</{tag}>")) {
                return Some(from + end + tag.len() + 3);
            }
            return Some(html.len());
        }
        None
    };
    while i < html.len() {
        if let Some(j) = drop_block("script", i).or_else(|| drop_block("style", i)).or_else(|| drop_block("noscript", i)) {
            i = j;
            continue;
        }
        if bytes[i] == b'<' {
            if let Some(end) = html[i..].find('>') {
                i += end + 1;
                cleaned.push(' ');
                continue;
            }
        }
        cleaned.push(html[i..].chars().next().unwrap_or(' '));
        i += html[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    }
    // decodifica entidades comuns + colapsa espaco
    let t = cleaned
        .replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"")
        .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    let collapsed: String = t.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max).collect()
}

/// IA (Groq, OpenAI-compat) — sentimento (JSON) + resumo de inteligencia. Key Config ou GROQ API.txt.
#[tauri::command]
async fn ai_chat(system: String, user: String, key: String, json: Option<bool>) -> Result<String, String> {
    let key = resolve_key(&key, "GROQ API.txt");
    if key.is_empty() {
        return Err("sem chave de IA (cole a chave Groq em Config)".into());
    }
    let mut body = serde_json::json!({
        "model": "openai/gpt-oss-120b",
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
    });
    if json.unwrap_or(false) {
        body["response_format"] = serde_json::json!({"type": "json_object"});
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("IA falhou (rede/timeout): {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("IA retornou {} (chave/limite?)", resp.status().as_u16()));
    }
    let j: serde_json::Value = resp.json().await.map_err(|e| format!("IA resposta invalida: {e}"))?;
    Ok(j["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
}

/// Um resultado de busca (Google via Serper).
#[derive(serde::Serialize)]
struct SearchHit {
    title: String,
    link: String,
    snippet: String,
    source: String,
    date: String,
    image: String,
}

/// Busca na web (Google real via Serper) — o motor "tipo Google" do Monitor.
/// endpoint: "search" (padrao) | "news" | "images". A chave vem do config local (nunca no repo).
#[tauri::command]
async fn web_search(
    query: String,
    key: String,
    endpoint: Option<String>,
    num: Option<u32>,
    site: Option<String>,
    tbs: Option<String>,
    page: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let key = resolve_key(&key, "SERPER.txt");
    if key.is_empty() {
        return Err("sem chave de busca (cole a chave Serper em Config)".into());
    }
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let ep = match endpoint.as_deref() {
        Some("news") => "news",
        Some("images") => "images",
        Some("videos") => "videos",
        Some("places") => "places",
        _ => "search",
    };
    let mut body = serde_json::json!({
        "q": query,
        "gl": "br",
        "hl": "pt",
        "num": num.unwrap_or(20).min(100),
    });
    // tbs = filtro/ordem do Google (qdr:d/w/m/y = periodo; sbd:1 = ordenar por data)
    if let Some(t) = tbs.as_deref().filter(|s| !s.is_empty()) {
        body["tbs"] = serde_json::Value::String(t.to_string());
    }
    if let Some(p) = page.filter(|p| *p > 1) {
        body["page"] = serde_json::json!(p);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("https://google.serper.dev/{ep}"))
        .header("X-API-KEY", key.as_str())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("busca falhou (rede/timeout): {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|j| j["message"].as_str().map(String::from))
            .unwrap_or(body);
        return Err(format!("busca {code}: {msg}"));
    }
    let j: serde_json::Value = resp.json().await.map_err(|e| format!("resposta invalida: {e}"))?;
    let host = |url: &str| -> String {
        url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or("").replace("www.", "")
    };
    let arr = j.get("organic")
        .or_else(|| j.get("news"))
        .or_else(|| j.get("videos"))
        .or_else(|| j.get("images"))
        .or_else(|| j.get("places"))
        .and_then(|v| v.as_array());
    let mut out = Vec::new();
    if let Some(a) = arr {
        for o in a {
            let link = o["link"].as_str().or_else(|| o["imageUrl"].as_str()).unwrap_or("").to_string();
            let source = o["source"].as_str().map(String::from).unwrap_or_else(|| host(&link));
            out.push(SearchHit {
                title: o["title"].as_str().unwrap_or("").to_string(),
                link,
                snippet: o["snippet"].as_str().unwrap_or("").to_string(),
                source,
                date: o["date"].as_str().unwrap_or("").to_string(),
                image: o["imageUrl"].as_str().or_else(|| o["thumbnailUrl"].as_str()).unwrap_or("").to_string(),
            });
        }
    }
    // filtro por dominio (escopo Instagram) — o Serper gratis NAO deixa usar `site:`,
    // entao busca normal + filtra o dominio aqui.
    if let Some(s) = site.as_deref().filter(|s| !s.is_empty()) {
        out.retain(|h| h.link.contains(s));
    }
    Ok(out)
}

/// Mostra/foca a janela do Instagram (recria se foi fechada).
#[tauri::command]
async fn focus_ig(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("ig") {
        let _ = w.show();
        let _ = w.set_focus();
        Ok(())
    } else {
        open_ig(&app).map_err(|e| e.to_string())
    }
}

/// So confirma que a sessao do webview esta lida (devolve o uid).
#[tauri::command]
async fn ig_session_ok(app: tauri::AppHandle) -> Result<String, String> {
    Ok(sess(&app).await?.ds)
}

/// Puxa seguindo + seguidores e ja devolve nao-seguidores (base do Painel/Limpar).
#[tauri::command]
async fn ig_graph(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let s = sess(&app).await?;
    let following = ig_api::friendships(&app, &s, "following").await?;
    let followers = ig_api::friendships(&app, &s, "followers").await?;
    let non = ig_api::non_followers(&following, &followers);
    Ok(serde_json::json!({
        "following_count": following.len(),
        "followers_count": followers.len(),
        "non_followers": non,
        "following": following,
        "followers": followers,
    }))
}

/// Ultimos posts (pro Relatorio).
#[tauri::command]
async fn ig_feed(app: tauri::AppHandle, count: Option<u32>) -> Result<Vec<Post>, String> {
    let s = sess(&app).await?;
    ig_api::feed(&app, &s, count.unwrap_or(12)).await
}

/// Pagina do feed a partir de max_id (scroll pra posts antigos na aba Posts).
#[tauri::command]
async fn ig_feed_page(app: tauri::AppHandle, count: Option<u32>, max_id: Option<String>) -> Result<ig_api::FeedPage, String> {
    let s = sess(&app).await?;
    ig_api::feed_page(&app, &s, count.unwrap_or(24), max_id.as_deref().unwrap_or("")).await
}

/// Quem CURTIU um post (media_id) — lista de likers da conta logada.
#[tauri::command]
async fn ig_likers(app: tauri::AppHandle, media_id: String) -> Result<Vec<ig_api::IgUser>, String> {
    let s = sess(&app).await?;
    ig_api::likers(&app, &s, &media_id).await
}

/// Quem COMENTOU um post (media_id) — user + texto, paginado.
#[tauri::command]
async fn ig_comments(app: tauri::AppHandle, media_id: String) -> Result<Vec<ig_api::Comment>, String> {
    let s = sess(&app).await?;
    ig_api::comments(&app, &s, &media_id).await
}

/// Contagem AO VIVO de um post (like/comment/reshare/save atuais).
#[tauri::command]
async fn ig_media_info(app: tauri::AppHandle, media_id: String) -> Result<ig_api::MediaCounts, String> {
    let s = sess(&app).await?;
    ig_api::media_info(&app, &s, &media_id).await
}

/// Quem RECOMPARTILHOU o post no story (auto-tenta os endpoints; vazio = ninguem ativo agora).
#[tauri::command]
async fn ig_reshares(app: tauri::AppHandle, media_id: String) -> Result<Vec<ig_api::IgUser>, String> {
    let s = sess(&app).await?;
    ig_api::reshares(&app, &s, &media_id).await
}

/// MODO CAPTURA: liga o sniffer na janela do IG (loga /api/v1 que a feature dispara).
#[tauri::command]
async fn ig_capture_start(app: tauri::AppHandle) -> Result<(), String> {
    ig_api::capture_start(&app)
}
#[tauri::command]
fn ig_capture_get() -> Vec<serde_json::Value> {
    ig_api::capture_get()
}
#[tauri::command]
fn ig_capture_clear() {
    ig_api::capture_clear();
}
/// Testa um endpoint /api/v1 descoberto na captura (reshares/reposts) — devolve o JSON cru.
#[tauri::command]
async fn ig_raw_get(app: tauri::AppHandle, url: String) -> Result<serde_json::Value, String> {
    ig_api::raw_get(&app, &url).await
}

/// SALVOS: um chunk dos itens salvos (+ cursor pra continuar). `resume` = cursor do chunk anterior.
#[tauri::command]
async fn ig_saved(app: tauri::AppHandle, resume: Option<String>) -> Result<ig_api::SavedResult, String> {
    ig_api::saved_cancel_reset(); // limpa cancelamento de uma corrida anterior
    let s = sess(&app).await?;
    ig_api::saved_feed(&app, &s, resume.as_deref().unwrap_or("")).await
}

/// Cancela o "puxar salvos" em andamento (o loop devolve o parcial + cursor).
#[tauri::command]
fn ig_saved_cancel() {
    ig_api::saved_cancel();
}

/// SALVOS: colecoes do usuario ([{id,name,count}]) — o nome vira dica de tema.
#[tauri::command]
async fn ig_collections(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let s = sess(&app).await?;
    ig_api::collections_list(&app, &s).await
}

/// SALVOS: itens de UMA colecao (o nome vira o tema no roteamento).
#[tauri::command]
async fn ig_collection(app: tauri::AppHandle, id: String, name: Option<String>, total: Option<i64>) -> Result<Vec<ig_api::SavedItem>, String> {
    ig_api::saved_cancel_reset();
    let s = sess(&app).await?;
    ig_api::collection_feed(&app, &s, &id, name.as_deref().unwrap_or(""), total.unwrap_or(0)).await
}

/// GATE: o Quartzo (comprado+instalado) é OBRIGATÓRIO pra essa feature. Detecta o app +
/// valida a licença Pro (lê o license.json do Quartzo e decodifica o token kind/exp).
/// Sem crypto-verify aqui (o Quartzo já valida a assinatura); MVP = install + token pago/owner válido.
/// ponytail: decode-only; hardening futuro = verificar Ed25519 c/ a pubkey do Quartzo.
#[tauri::command]
fn quartzo_status() -> serde_json::Value {
    use base64::Engine;
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let data_dir = format!("{appdata}\\com.quartzo.app");
    let installed = std::path::Path::new(&format!("{local}\\Quartzo")).exists()
        || std::path::Path::new(&data_dir).exists();
    let mut pro = false;
    let mut kind = String::new();
    if let Ok(s) = std::fs::read_to_string(format!("{data_dir}\\license.json")) {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(tok) = j["token"].as_str() {
                if let Some(pb) = tok.split('.').next() {
                    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(pb) {
                        if let Ok(p) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                            kind = p["kind"].as_str().unwrap_or("").to_string();
                            let exp = p["exp"].as_u64().unwrap_or(0);
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            let grace = if kind == "trial" { 0 } else { 7 * 86400 };
                            if (kind == "paid" || kind == "owner") && now < exp + grace {
                                pro = true;
                            }
                        }
                    }
                }
            }
        }
    }
    serde_json::json!({ "installed": installed, "pro": pro, "kind": kind })
}

/// ABSORVER: dispara o motor (node) que vira os salvos em receita no vault. GATE Quartzo Pro.
/// `codes` = absorve só esses (seleção do usuário); senão `limit` (últimos N). Progresso via absorb_status.
#[tauri::command]
fn absorb_run(
    limit: Option<u32>,
    codes: Option<Vec<String>>,
    dest: Option<String>,
) -> Result<String, String> {
    // GATE: sem Quartzo Pro, a feature não roda.
    if !quartzo_status()["pro"].as_bool().unwrap_or(false) {
        return Err("QUARTZO_REQUIRED".into());
    }
    let work = std::env::temp_dir().join("codexig-absorb");
    std::fs::create_dir_all(&work).map_err(|e| format!("criar pasta: {e}"))?;
    let script = work.join("absorb_saved.mjs");
    std::fs::write(&script, include_str!("../../scripts/absorb_saved.mjs")).map_err(|e| format!("escrever script: {e}"))?;
    let _ = std::fs::write(work.join("absorb.log"), ""); // zera o log
    let arg = match codes {
        Some(c) if !c.is_empty() => format!("codes:{}", c.join(",")),
        _ => limit.unwrap_or(100).to_string(),
    };
    let mut cmd = std::process::Command::new("node");
    cmd.arg(&script).arg(&arg).current_dir(&work);
    // destino forçado pelo usuário (vault existente / novo / da coleção); vazio = auto.
    if let Some(d) = dest.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        cmd.arg(format!("vault:{d}"));
    }
    // Windows: roda o node SEM abrir janela de console (CREATE_NO_WINDOW) — o progresso
    // aparece só dentro do app (painel), nunca um CMD preto na cara do usuário.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let child = cmd.spawn()
        .map_err(|e| format!("não consegui rodar o node (instalado?): {e}"))?;
    *ABSORB_PID.lock().unwrap() = Some(child.id()); // guarda o pid pro Cancelar matar
    Ok("started".into())
}

/// pid do node da absorção em andamento (pro botão Cancelar).
static ABSORB_PID: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);

/// Cancela a absorção em andamento: mata o node + filhos (yt-dlp/gallery-dl). O estado
/// (`_FILA-ESTADO.json`) já é gravado item-a-item, então parar no meio não corrompe nada.
#[tauri::command]
fn absorb_cancel() {
    let pid = ABSORB_PID.lock().unwrap().take();
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .spawn();
        }
    }
}

/// Status do motor de absorção (lê o log): contagens + últimas linhas + se terminou.
#[tauri::command]
fn absorb_status() -> Result<serde_json::Value, String> {
    let log = std::env::temp_dir().join("codexig-absorb").join("absorb.log");
    let txt = std::fs::read_to_string(&log).unwrap_or_default();
    let lines: Vec<&str> = txt.lines().collect();
    let count = |p: &str| lines.iter().filter(|l| l.starts_with(p)).count();
    let tail: Vec<String> = lines.iter().rev().take(14).rev().map(|s| s.to_string()).collect();
    let finished = lines.iter().rev().take(2).any(|l| l.contains("=== FIM"));
    Ok(serde_json::json!({
        "ok": count("[ok"),
        "skip": count("[skip"),
        "fail": count("[fail"),
        "dup": count("[dup"),
        "finished": finished,
        "tail": tail,
    }))
}

/// Lista os vaults existentes (pastas em G:\VAULTS) pro usuário escolher o destino da absorção.
#[tauri::command]
fn list_vaults() -> Vec<String> {
    let base = std::path::Path::new("G:/Meu Drive/VAULTS");
    let mut v: Vec<String> = std::fs::read_dir(base)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| !n.starts_with('_') && !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Unfollow de uma conta (o chamador ritma/whitelista; para no BLOCK 429/400).
#[tauri::command]
async fn ig_destroy(app: tauri::AppHandle, pk: String) -> Result<(), String> {
    let s = sess(&app).await?;
    ig_api::destroy(&app, &s, &pk).await
}

/// Público-alvo: seguidores dos concorrentes, tirando quem eu já sigo (fila assistida).
#[tauri::command]
async fn ig_targets(
    app: tauri::AppHandle,
    competitors: Vec<String>,
    cap: Option<u32>,
) -> Result<Vec<ig_api::IgUser>, String> {
    let s = sess(&app).await?;
    let cap = cap.unwrap_or(300) as usize;
    let following = ig_api::friendships(&app, &s, "following").await?;
    let already: std::collections::HashSet<String> =
        following.iter().map(|u| u.pk.clone()).collect();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut agg: Vec<ig_api::IgUser> = Vec::new();
    for name in competitors {
        let name = name.trim().trim_start_matches('@');
        if name.is_empty() {
            continue;
        }
        let prof = match ig_api::profile(&app, &s, name).await {
            Ok(p) => p,
            Err(_) => continue,
        };
        let id = prof["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() {
            continue;
        }
        for u in ig_api::followers_of(&app, &s, &id, cap).await? {
            if u.pk == s.ds || already.contains(&u.pk) || !seen.insert(u.pk.clone()) {
                continue;
            }
            agg.push(u);
        }
    }
    agg.sort_by(|a, b| {
        (a.is_private as u8)
            .cmp(&(b.is_private as u8))
            .then((a.full.is_empty() as u8).cmp(&(b.full.is_empty() as u8)))
            .then((a.is_verified as u8).cmp(&(b.is_verified as u8)))
    });
    Ok(agg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init: account/snapshot/whitelist/unfollow_log/post_metric/tracker_link",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:codexig.db", migrations)
                .build(),
        );
    // updater + process sao crates desktop-only (gated no Cargo.toml) — registrar so no desktop,
    // senao um build android/ios nao compila (referencia a crate ausente).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            ig_api::install_ig_listener(app.handle());
            ig_api::install_capture_listener(app.handle());
            open_ig(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ig_session_ok,
            ig_graph,
            ig_feed,
            ig_feed_page,
            ig_likers,
            ig_comments,
            ig_media_info,
            ig_reshares,
            ig_saved,
            ig_collections,
            ig_collection,
            absorb_run,
            absorb_status,
            absorb_cancel,
            ig_saved_cancel,
            list_vaults,
            quartzo_status,
            ig_capture_start,
            ig_capture_get,
            ig_capture_clear,
            ig_raw_get,
            ig_destroy,
            ig_targets,
            write_bytes,
            read_bytes,
            web_search,
            ai_chat,
            fetch_page,
            focus_ig
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
