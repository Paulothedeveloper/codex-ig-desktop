// ig_api.rs — cliente da API web interna do Instagram.
// MOTOR: o fetch roda DENTRO da webview logada (Chrome real: TLS/HTTP2 legitimos + cookies
// httpOnly automaticos + same-origin). Fazer o request de fora (reqwest) o Meta detecta pelo
// fingerprint e bounce pro homepage (bug landed=/), mesmo com o cookie certo. A webview faz o
// fetch e EMITE o resultado de volta pro Rust por evento (capability ig-remote + withGlobalTauri).
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Listener, Manager};

pub const LOGIN: &str = "require_login"; // sentinela: sem sessao -> front mostra "faca login"
pub const RATE: &str = "ig_rate_limited"; // IG limitou/bloqueou temporario -> front "espere uns minutos"

/// Resultados dos fetch da webview, por id de request (preenchido pelo listener do evento).
fn results() -> &'static Mutex<HashMap<u64, String>> {
    static R: OnceLock<Mutex<HashMap<u64, String>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}
static COUNTER: AtomicU64 = AtomicU64::new(1);

/// Registra o listener do evento 'ig_result' (chamar 1x no setup). A webview emite
/// {id, ok, status, url, body}; guardamos o payload cru por id pro webview_fetch pegar.
pub fn install_ig_listener(app: &tauri::AppHandle) {
    app.listen("ig_result", |event| {
        let payload = event.payload();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
            if let Some(id) = v["id"].as_u64() {
                results().lock().unwrap().insert(id, payload.to_string());
            }
        }
    });
}

/// Jitter derivado do relogio — evita intervalo fixo (mais fingerprintavel) nas leituras.
fn jitter_ms(base: u64) -> u64 {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    base + (n % (base / 2 + 1))
}

#[derive(Clone)]
pub struct Session {
    pub ds: String,   // user id (pra montar a URL)
    pub csrf: String, // x-csrftoken
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct IgUser {
    pub pk: String,
    pub username: String,
    pub full: String,
    #[serde(rename = "priv")]
    pub is_private: bool,
    #[serde(rename = "verif")]
    pub is_verified: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Post {
    pub id: String,    // media_id (pra puxar likers/comments)
    pub code: String,  // shortcode (link do post)
    pub thumb: String, // url da miniatura
    pub like: i64,
    pub cmt: i64,
    pub views: i64,
    pub taken_at: i64,
    pub caption: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Comment {
    pub user: IgUser,
    pub text: String,
    pub likes: i64,
}

/// Le ds_user_id + csrftoken (nao-httpOnly) da webview so pra montar URL+header. A AUTENTICACAO
/// (sessionid httpOnly) fica com o browser no fetch. Sem ds = deslogado -> require_login.
pub async fn session_from_webview(app: &tauri::AppHandle) -> Result<Session, String> {
    let wv = app
        .get_webview_window("ig")
        .ok_or("webview 'ig' nao existe")?;
    let url: tauri::Url = "https://www.instagram.com/".parse().unwrap();
    let cookies = wv
        .cookies_for_url(url)
        .map_err(|e| format!("cookies(): {e}"))?;
    let (mut ds, mut csrf) = (String::new(), String::new());
    for c in &cookies {
        match c.name() {
            "ds_user_id" => ds = c.value().to_string(),
            "csrftoken" => csrf = c.value().to_string(),
            _ => {}
        }
    }
    if ds.is_empty() {
        return Err(format!("{LOGIN} [sem ds_user_id, n={}]", cookies.len()));
    }
    Ok(Session { ds, csrf })
}

/// Roda o fetch DENTRO da webview 'ig' e espera o resultado (via evento). Retorna o JSON.
/// post=true => POST form (unfollow). Sessao caida = o IG bounce e a URL final sai de /api/v1.
async fn webview_fetch(
    app: &tauri::AppHandle,
    url: &str,
    post: bool,
    csrf: &str,
) -> Result<serde_json::Value, String> {
    let wv = app
        .get_webview_window("ig")
        .ok_or(format!("{LOGIN} [janela IG fechada]"))?;
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let method = if post { "POST" } else { "GET" };
    let extra = if post {
        ",'content-type':'application/x-www-form-urlencoded'"
    } else {
        ""
    };
    let bodypart = if post { ",body:''" } else { "" };
    // url/csrf quotados via serde_json = string JS valida e sem injecao.
    let js = format!(
        "(async()=>{{try{{const r=await fetch({url},{{credentials:'include',method:'{method}',\
headers:{{'x-ig-app-id':'936619743392459','x-csrftoken':{csrf},'x-asbd-id':'129477',\
'x-ig-www-claim':'0','x-requested-with':'XMLHttpRequest'{extra}}}{bodypart}}});const t=await r.text();\
window.__TAURI__.event.emit('ig_result',{{id:{id},ok:r.ok,status:r.status,url:r.url,ct:(r.headers.get('content-type')||''),body:t}});}}\
catch(e){{window.__TAURI__.event.emit('ig_result',{{id:{id},ok:false,status:0,url:'',ct:'',body:'ERR:'+String(e)}});}}}})();",
        url = serde_json::to_string(url).unwrap(),
        csrf = serde_json::to_string(csrf).unwrap(),
    );
    wv.eval(&js).map_err(|e| format!("eval: {e}"))?;

    // poll do resultado (webview responde em ms; teto 30s pra pagina grande)
    for _ in 0..600 {
        let hit = results().lock().unwrap().remove(&id);
        if let Some(payload) = hit {
            let v: serde_json::Value =
                serde_json::from_str(&payload).map_err(|e| format!("ingest: {e}"))?;
            let status = v["status"].as_u64().unwrap_or(0);
            let ok = v["ok"].as_bool().unwrap_or(false);
            let final_url = v["url"].as_str().unwrap_or("");
            let body = v["body"].as_str().unwrap_or("");

            // fetch do browser falhou (rede) — transitorio, tratar como "tente de novo".
            if body.starts_with("ERR:") {
                return Err(RATE.into());
            }
            // Bloqueio temporario do IG: responde 401 JSON "Aguarde alguns minutos..." OU redireciona
            // a chamada pro homepage (HTML). Como o ds ja foi confirmado (logado), isto NUNCA e logout
            // — e throttle/checkpoint. Peek na mensagem do JSON confirma o soft-block.
            if let Ok(jv) = serde_json::from_str::<serde_json::Value>(body) {
                let m = jv["message"].as_str().unwrap_or("").to_lowercase();
                if jv["require_login"].as_bool().unwrap_or(false)
                    || m.contains("aguarde")
                    || m.contains("wait")
                    || m.contains("few minutes")
                    || m.contains("try again")
                    || m.contains("spam")
                {
                    return Err(RATE.into());
                }
            }
            if status == 429 || status == 400 {
                return Err("BLOCK".into()); // usado por destroy pra parar a limpeza
            }
            // redirecionou pro homepage (saiu de /api/v1) estando logado = block/checkpoint temporario
            if !final_url.contains("/api/v1/") || status == 401 || status == 403 {
                return Err(RATE.into());
            }
            if !ok {
                return Err(format!("HTTP {status}"));
            }
            // corpo nao-JSON num endpoint de API = parede do IG (HTML) = throttle
            return serde_json::from_str(body).map_err(|_| RATE.to_string());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("timeout: a janela do Instagram nao respondeu (recarregue a janela e tente)".into())
}

fn parse_users(j: &serde_json::Value) -> Vec<IgUser> {
    j["users"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|u| IgUser {
                    pk: u["pk"].as_str().map(String::from).unwrap_or_else(|| {
                        u["pk"].as_i64().map(|n| n.to_string()).unwrap_or_default()
                    }),
                    username: u["username"].as_str().unwrap_or("").to_string(),
                    full: u["full_name"].as_str().unwrap_or("").to_string(),
                    is_private: u["is_private"].as_bool().unwrap_or(false),
                    is_verified: u["is_verified"].as_bool().unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Lista paginada (count=200) + ritmada. kind = "following" | "followers".
pub async fn friendships(
    app: &tauri::AppHandle,
    s: &Session,
    kind: &str,
) -> Result<Vec<IgUser>, String> {
    let mut out = Vec::new();
    let mut next = String::new();
    for _ in 0..300 {
        let url = format!(
            "https://www.instagram.com/api/v1/friendships/{}/{}/?count=200{}",
            s.ds,
            kind,
            if next.is_empty() {
                String::new()
            } else {
                format!("&max_id={next}")
            }
        );
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        out.extend(parse_users(&j));
        next = j["next_max_id"].as_str().unwrap_or("").to_string();
        if next.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(600))).await; // ritmo anti-ban + jitter
    }
    Ok(out)
}

/// Ultimos posts proprios (likes/coments/views publicos) pro Relatorio.
pub async fn feed(app: &tauri::AppHandle, s: &Session, count: u32) -> Result<Vec<Post>, String> {
    let url = format!(
        "https://www.instagram.com/api/v1/feed/user/{}/?count={count}",
        s.ds
    );
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    Ok(j["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|it| Post {
                    id: it["id"].as_str().unwrap_or("").to_string(),
                    code: it["code"].as_str().unwrap_or("").to_string(),
                    thumb: it["image_versions2"]["candidates"]
                        .as_array()
                        .and_then(|c| c.last())
                        .and_then(|c| c["url"].as_str())
                        .or_else(|| {
                            it["carousel_media"][0]["image_versions2"]["candidates"]
                                .as_array()
                                .and_then(|c| c.last())
                                .and_then(|c| c["url"].as_str())
                        })
                        .unwrap_or("")
                        .to_string(),
                    like: it["like_count"].as_i64().unwrap_or(0),
                    cmt: it["comment_count"].as_i64().unwrap_or(0),
                    views: it["play_count"]
                        .as_i64()
                        .or_else(|| it["view_count"].as_i64())
                        .unwrap_or(0),
                    taken_at: it["taken_at"].as_i64().unwrap_or(0),
                    caption: it["caption"]["text"]
                        .as_str()
                        .unwrap_or("")
                        .chars()
                        .take(120)
                        .collect(),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Quem CURTIU um post (media_id). Endpoint da API interna — para posts do dono da sessao,
/// devolve a lista completa de likers (nao paginado; o IG limita a ~alguns milhares).
pub async fn likers(
    app: &tauri::AppHandle,
    s: &Session,
    media_id: &str,
) -> Result<Vec<IgUser>, String> {
    if media_id.is_empty() || !media_id.chars().all(|c| c.is_ascii_digit() || c == '_') {
        return Err("media_id invalido".into());
    }
    let url = format!("https://www.instagram.com/api/v1/media/{media_id}/likers/");
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    Ok(parse_users(&j))
}

/// Quem COMENTOU um post (media_id), paginado + ritmado. Devolve user + texto do comentario.
pub async fn comments(
    app: &tauri::AppHandle,
    s: &Session,
    media_id: &str,
) -> Result<Vec<Comment>, String> {
    if media_id.is_empty() || !media_id.chars().all(|c| c.is_ascii_digit() || c == '_') {
        return Err("media_id invalido".into());
    }
    let mut out = Vec::new();
    let mut next = String::new();
    for _ in 0..60 {
        let url = format!(
            "https://www.instagram.com/api/v1/media/{media_id}/comments/?can_support_threading=false&permalink_enabled=false{}",
            if next.is_empty() {
                String::new()
            } else {
                format!("&min_id={next}")
            }
        );
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        if let Some(arr) = j["comments"].as_array() {
            for c in arr {
                let u = &c["user"];
                out.push(Comment {
                    user: IgUser {
                        pk: u["pk"].as_str().map(String::from).unwrap_or_else(|| {
                            u["pk"].as_i64().map(|n| n.to_string()).unwrap_or_default()
                        }),
                        username: u["username"].as_str().unwrap_or("").to_string(),
                        full: u["full_name"].as_str().unwrap_or("").to_string(),
                        is_private: u["is_private"].as_bool().unwrap_or(false),
                        is_verified: u["is_verified"].as_bool().unwrap_or(false),
                    },
                    text: c["text"].as_str().unwrap_or("").chars().take(280).collect(),
                    likes: c["comment_like_count"].as_i64().unwrap_or(0),
                });
            }
        }
        next = j["next_min_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_min_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        let has_more = j["has_more_comments"].as_bool().unwrap_or(false);
        if next.is_empty() || !has_more {
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(600))).await;
    }
    Ok(out)
}

/// Perfil público por username (web_profile_info) → devolve o JSON do user (id, contagens).
pub async fn profile(
    app: &tauri::AppHandle,
    s: &Session,
    username: &str,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username={}",
        urlencode(username)
    );
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    Ok(j["data"]["user"].clone())
}

/// Seguidores de um perfil (concorrente PÚBLICO), paginado + ritmado, até `cap`.
pub async fn followers_of(
    app: &tauri::AppHandle,
    s: &Session,
    pk: &str,
    cap: usize,
) -> Result<Vec<IgUser>, String> {
    let mut out = Vec::new();
    let mut next = String::new();
    for _ in 0..80 {
        let url = format!(
            "https://www.instagram.com/api/v1/friendships/{}/followers/?count=100{}",
            pk,
            if next.is_empty() {
                String::new()
            } else {
                format!("&max_id={next}")
            }
        );
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        out.extend(parse_users(&j));
        next = j["next_max_id"].as_str().unwrap_or("").to_string();
        if next.is_empty() || out.len() >= cap {
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(700))).await;
    }
    out.truncate(cap);
    Ok(out)
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.".contains(c) {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

/// Unfollow (escrita — o chamador ritma/whitelista/para no BLOCK).
pub async fn destroy(app: &tauri::AppHandle, s: &Session, pk: &str) -> Result<(), String> {
    // pk vem do front (do usuario), validar antes de injetar na URL.
    if pk.is_empty() || !pk.chars().all(|c| c.is_ascii_digit()) {
        return Err("pk invalido".into());
    }
    let url = format!("https://www.instagram.com/api/v1/friendships/destroy/{pk}/");
    // webview_fetch mapeia 400/429 -> BLOCK (chamador para) e login-bounce -> require_login.
    let j = webview_fetch(app, &url, true, &s.csrf).await?;
    if j["status"].as_str() == Some("ok") {
        Ok(())
    } else {
        Err(format!("HTTP {j}"))
    }
}

/// PURA: nao-seguidores = seguindo - seguidores (por pk). Unit-testavel, sem rede.
pub fn non_followers(following: &[IgUser], followers: &[IgUser]) -> Vec<IgUser> {
    let fset: std::collections::HashSet<&str> = followers.iter().map(|u| u.pk.as_str()).collect();
    following
        .iter()
        .filter(|u| !fset.contains(u.pk.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(pk: &str) -> IgUser {
        IgUser {
            pk: pk.into(),
            username: format!("u{pk}"),
            full: String::new(),
            is_private: false,
            is_verified: false,
        }
    }
    #[test]
    fn nonfollowers_set_diff() {
        let following = vec![u("1"), u("2"), u("3"), u("4")];
        let followers = vec![u("2"), u("4"), u("9")]; // 9 = fa (nao esta em following)
        let nf = non_followers(&following, &followers);
        let pks: Vec<&str> = nf.iter().map(|x| x.pk.as_str()).collect();
        assert_eq!(pks, vec!["1", "3"]); // so 1 e 3 nao retribuem
    }
    #[test]
    fn nonfollowers_empty_when_all_mutual() {
        let f = vec![u("1"), u("2")];
        assert!(non_followers(&f, &f).is_empty());
    }
}
