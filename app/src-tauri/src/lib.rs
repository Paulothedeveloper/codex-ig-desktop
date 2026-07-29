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
    std::fs::write(&path, &bytes).map_err(|e| format!("escrever {path}: {e}"))
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
            ig_capture_start,
            ig_capture_get,
            ig_capture_clear,
            ig_raw_get,
            ig_destroy,
            ig_targets,
            write_bytes,
            focus_ig
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
