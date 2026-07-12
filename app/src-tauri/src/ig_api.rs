// ig_api.rs — cliente da API web interna do Instagram usando a sessao do WebView2.
// Leitura paginada + ritmada (anti-ban). Endpoints isolados aqui (IG muda sem avisar).
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;

const APPID: &str = "936619743392459"; // x-ig-app-id publico
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/// 1 Client reusavel (keep-alive + pool) com timeout — request sem timeout que pendura
/// o socket travaria o comando inteiro; criar Client por request mata o keep-alive.
fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client")
    })
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
    pub ds: String,
    pub csrf: String,
    pub cookie: String, // jar inteiro (incl sessionid httpOnly)
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
    pub code: String,
    pub like: i64,
    pub cmt: i64,
    pub views: i64,
    pub taken_at: i64,
    pub caption: String,
}

/// Le os cookies do webview "ig" e monta a Session (reencaminha o JAR INTEIRO —
/// so ds_user_id+csrftoken = 401 require_login). `cookies()` = async (trava sincrono no Windows).
pub async fn session_from_webview(app: &tauri::AppHandle) -> Result<Session, String> {
    let wv = app
        .get_webview_window("ig")
        .ok_or("webview 'ig' nao existe")?;
    let cookies = wv.cookies().map_err(|e| format!("cookies(): {e}"))?;
    let (mut ds, mut csrf, mut jar) = (String::new(), String::new(), Vec::new());
    for c in &cookies {
        let (n, v) = (c.name(), c.value());
        if n == "ds_user_id" {
            ds = v.to_string();
        }
        if n == "csrftoken" {
            csrf = v.to_string();
        }
        jar.push(format!("{n}={v}"));
    }
    if ds.is_empty() {
        return Err("sem sessao — faca login no Instagram na aba".into());
    }
    Ok(Session {
        ds,
        csrf,
        cookie: jar.join("; "),
    })
}

async fn get_json(s: &Session, url: &str) -> Result<serde_json::Value, String> {
    let mut attempt: u64 = 0;
    loop {
        let res = client()
            .get(url)
            .header("x-ig-app-id", APPID)
            .header("x-csrftoken", &s.csrf)
            .header("x-requested-with", "XMLHttpRequest")
            .header("x-asbd-id", "129477")
            .header("referer", "https://www.instagram.com/")
            .header("sec-fetch-site", "same-origin")
            .header("sec-fetch-mode", "cors")
            .header("sec-fetch-dest", "empty")
            .header("cookie", &s.cookie)
            .header("user-agent", UA)
            .send()
            .await;
        match res {
            Ok(r) => {
                let st = r.status();
                if st.as_u16() == 429 {
                    attempt += 1;
                    if attempt >= 3 {
                        return Err("429".into()); // rate-limit persistente -> chamador para
                    }
                    tokio::time::sleep(Duration::from_secs(2 * attempt)).await; // backoff 2s,4s
                    continue;
                }
                if !st.is_success() {
                    return Err(format!("HTTP {st}"));
                }
                return r.json().await.map_err(|e| format!("json: {e}"));
            }
            Err(e) => {
                // timeout/conexao — 1 retry curto antes de desistir
                attempt += 1;
                if attempt >= 3 {
                    return Err(format!("req: {e}"));
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
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
pub async fn friendships(s: &Session, kind: &str) -> Result<Vec<IgUser>, String> {
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
        let j = get_json(s, &url).await?;
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
pub async fn feed(s: &Session, count: u32) -> Result<Vec<Post>, String> {
    let url = format!(
        "https://www.instagram.com/api/v1/feed/user/{}/?count={count}",
        s.ds
    );
    let j = get_json(s, &url).await?;
    Ok(j["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|it| Post {
                    code: it["code"].as_str().unwrap_or("").to_string(),
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

/// Perfil público por username (web_profile_info) → devolve o JSON do user (id, contagens).
pub async fn profile(s: &Session, username: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username={}",
        urlencode(username)
    );
    let j = get_json(s, &url).await?;
    Ok(j["data"]["user"].clone())
}

/// Seguidores de um perfil (concorrente PÚBLICO), paginado + ritmado, até `cap`.
pub async fn followers_of(s: &Session, pk: &str, cap: usize) -> Result<Vec<IgUser>, String> {
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
        let j = get_json(s, &url).await?;
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
pub async fn destroy(s: &Session, pk: &str) -> Result<(), String> {
    // pk vem do front (do usuario), mas validar antes de injetar na URL (input no comando Rust)
    if pk.is_empty() || !pk.chars().all(|c| c.is_ascii_digit()) {
        return Err("pk invalido".into());
    }
    let url = format!("https://www.instagram.com/api/v1/friendships/destroy/{pk}/");
    let r = client()
        .post(&url)
        .header("x-ig-app-id", APPID)
        .header("x-csrftoken", &s.csrf)
        .header("x-requested-with", "XMLHttpRequest")
        .header("referer", "https://www.instagram.com/")
        .header("cookie", &s.cookie)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", UA)
        .send()
        .await
        .map_err(|e| format!("req: {e}"))?;
    let st = r.status();
    if st.as_u16() == 429 || st.as_u16() == 400 {
        return Err(format!("BLOCK {st}")); // IG reclamou -> parar tudo
    }
    if !st.is_success() {
        return Err(format!("HTTP {st}"));
    }
    Ok(())
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
