// SPIKE Codex IG — prova make-or-break do Motor B:
// (a) Tauri abre webview no instagram.com, (b) injeta init-script,
// (c) o Rust le o cookie de sessao do WebView2 e faz UMA chamada i/api/v1 autenticada.
// Gotcha (docs.rs): WebviewWindow::cookies() TRAVA em comando sincrono no Windows -> comando ASYNC.
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn spike_following_count(app: tauri::AppHandle) -> Result<String, String> {
    let wv = app.get_webview_window("ig").ok_or("webview 'ig' nao existe")?;
    let cookies = wv.cookies().map_err(|e| format!("cookies(): {e}"))?;
    let mut ds = String::new();
    let mut csrf = String::new();
    let mut has_session = false;
    let mut jar: Vec<String> = Vec::new();
    for c in &cookies {
        let (name, value) = (c.name(), c.value());
        match name {
            "ds_user_id" => ds = value.to_string(),
            "csrftoken" => csrf = value.to_string(),
            "sessionid" => has_session = true,
            _ => {}
        }
        jar.push(format!("{name}={value}"));
    }
    if ds.is_empty() {
        return Err(format!(
            "sem ds_user_id (achei {} cookies) — faca login no Instagram na outra janela primeiro",
            cookies.len()
        ));
    }
    // reencaminha o JAR INTEIRO (inclui sessionid httpOnly = o que autentica de fato)
    let cookie_hdr = jar.join("; ");
    let url = format!("https://www.instagram.com/api/v1/friendships/{ds}/following/?count=1");
    let cli = reqwest::Client::new();
    let resp = cli
        .get(&url)
        .header("x-ig-app-id", "936619743392459")
        .header("x-csrftoken", &csrf)
        .header("x-requested-with", "XMLHttpRequest")
        .header("x-asbd-id", "129477")
        .header("referer", "https://www.instagram.com/")
        .header("sec-fetch-site", "same-origin")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-dest", "empty")
        .header("cookie", cookie_hdr)
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "HTTP {status} ({} cookies, sessionid={}) — corpo: {}",
            cookies.len(),
            has_session,
            &body[..body.len().min(200)]
        ));
    }
    let j: serde_json::Value = serde_json::from_str(&body).map_err(|e| format!("json: {e}"))?;
    let n = j["users"].as_array().map(|a| a.len()).unwrap_or(0);
    Ok(format!(
        "OK — autenticado! uid={ds}, {} cookies (sessionid={}), HTTP {status}, 'users' no payload: {n}. MOTOR B VIAVEL.",
        cookies.len(),
        has_session
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "ig",
                WebviewUrl::External("https://www.instagram.com/".parse().unwrap()),
            )
            .title("Codex IG — Instagram (FACA LOGIN AQUI)")
            .initialization_script(
                "window.__CODEX_SPIKE__=true;console.log('[codex] init-script injetado no instagram.com');",
            )
            .inner_size(1100.0, 820.0)
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![spike_following_count])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
