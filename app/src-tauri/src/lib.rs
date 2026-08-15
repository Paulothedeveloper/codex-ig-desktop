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

/// IA (Groq, OpenAI-compat) — sentimento (JSON) + resumo de inteligencia. Key Config ou GROQ API.txt.
#[tauri::command]
async fn ai_chat(system: String, user: String, key: String, json: Option<bool>) -> Result<String, String> {
    let key = resolve_key(&key, "GROQ API.txt");
    if key.is_empty() {
        return Err("sem chave de IA (cole a chave Groq em Config)".into());
    }
    let mut body = serde_json::json!({
        "model": "llama-3.3-70b-versatile",
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

/// SALVOS: lista todos os itens salvos (pro roteador de conhecimento -> vault).
#[tauri::command]
async fn ig_saved(app: tauri::AppHandle) -> Result<Vec<ig_api::SavedItem>, String> {
    let s = sess(&app).await?;
    ig_api::saved_feed(&app, &s).await
}

/// SALVOS: colecoes do usuario ([{id,name,count}]) — o nome vira dica de tema.
#[tauri::command]
async fn ig_collections(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let s = sess(&app).await?;
    ig_api::collections_list(&app, &s).await
}

/// SALVOS: itens de UMA colecao (o nome vira o tema no roteamento).
#[tauri::command]
async fn ig_collection(app: tauri::AppHandle, id: String, name: Option<String>) -> Result<Vec<ig_api::SavedItem>, String> {
    let s = sess(&app).await?;
    ig_api::collection_feed(&app, &s, &id, name.as_deref().unwrap_or("")).await
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
            focus_ig
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
