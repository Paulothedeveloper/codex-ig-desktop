// Codex IG Desktop — backend Tauri.
// SQLite (tauri-plugin-sql) + comandos que usam o modulo ig_api (sessao do WebView -> API do IG).
mod ig_api;
use ig_api::{Post, Session};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

async fn sess(app: &tauri::AppHandle) -> Result<Session, String> {
    ig_api::session_from_webview(app).await
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
    let following = ig_api::friendships(&s, "following").await?;
    let followers = ig_api::friendships(&s, "followers").await?;
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
    ig_api::feed(&s, count.unwrap_or(12)).await
}

/// Unfollow de uma conta (o chamador ritma/whitelista; para no BLOCK 429/400).
#[tauri::command]
async fn ig_destroy(app: tauri::AppHandle, pk: String) -> Result<(), String> {
    let s = sess(&app).await?;
    ig_api::destroy(&s, &pk).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init: account/snapshot/whitelist/unfollow_log/post_metric/tracker_link",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:codexig.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            ig_session_ok,
            ig_graph,
            ig_feed,
            ig_destroy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
