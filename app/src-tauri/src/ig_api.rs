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
use tauri::{Emitter, Listener, Manager};

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

/// MODO CAPTURA: guarda os endpoints /api/v1 que a janela do IG dispara (pra descobrir o
/// endpoint real de reshares/reposts sem CHUTAR — o usuario usa a feature, o sniffer loga).
fn captured() -> &'static Mutex<Vec<(String, String)>> {
    static C: OnceLock<Mutex<Vec<(String, String)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(Vec::new()))
}

/// Listener do evento 'ig_endpoint' emitido pelo sniffer (url+method). Dedup. Chamar 1x no setup.
pub fn install_capture_listener(app: &tauri::AppHandle) {
    app.listen("ig_endpoint", |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let url = v["url"].as_str().unwrap_or("").to_string();
            let method = v["method"].as_str().unwrap_or("GET").to_string();
            if url.contains("/api/v1/") {
                let mut c = captured().lock().unwrap();
                if !c.iter().any(|(u, _)| u == &url) {
                    c.push((url, method));
                    if c.len() > 400 {
                        c.remove(0);
                    }
                }
            }
        }
    });
}

/// Injeta o sniffer na janela 'ig' (patch em fetch + XHR -> emite 'ig_endpoint'). Idempotente.
pub fn capture_start(app: &tauri::AppHandle) -> Result<(), String> {
    let wv = app
        .get_webview_window("ig")
        .ok_or(format!("{LOGIN} [janela IG fechada]"))?;
    let js = r#"(()=>{if(window.__codexSniff)return;window.__codexSniff=true;
const em=(u,m)=>{try{const s=String(u||'');if(s.indexOf('/api/v1/')>=0)window.__TAURI__.event.emit('ig_endpoint',{url:s,method:m||'GET'});}catch(e){}};
const of=window.fetch;window.fetch=function(u,o){em((u&&u.url)||u,o&&o.method);return of.apply(this,arguments)};
const oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){em(u,m);return oo.apply(this,arguments)};})();"#;
    wv.eval(js).map_err(|e| format!("eval: {e}"))?;
    Ok(())
}

/// Devolve os endpoints capturados (mais recentes primeiro). Marca os "interessantes"
/// (reshare/repost/resharer/share) pra o usuario achar rapido.
pub fn capture_get() -> Vec<serde_json::Value> {
    let c = captured().lock().unwrap();
    c.iter()
        .rev()
        .map(|(url, method)| {
            let low = url.to_lowercase();
            let hot = low.contains("reshar") || low.contains("repost") || low.contains("resharer");
            serde_json::json!({ "url": url, "method": method, "hot": hot })
        })
        .collect()
}

pub fn capture_clear() {
    captured().lock().unwrap().clear();
}

/// Chamada CRUA a um endpoint /api/v1 arbitrario (descoberto na captura) — pra testar reshares/reposts
/// depois de achar a URL. Valida que e do dominio do IG. Devolve o JSON.
pub async fn raw_get(app: &tauri::AppHandle, path_or_url: &str) -> Result<serde_json::Value, String> {
    let url = if path_or_url.starts_with("https://www.instagram.com/") {
        path_or_url.to_string()
    } else if path_or_url.starts_with("/api/v1/") {
        format!("https://www.instagram.com{path_or_url}")
    } else {
        return Err("url invalida (precisa ser /api/v1/... do instagram.com)".into());
    };
    let s = session_from_webview(app).await?;
    webview_fetch(app, &url, false, &s.csrf).await
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
    pub reshares: i64, // nº de compartilhamentos (se o IG mandar; -1 = não veio)
    pub saves: i64,    // nº de salvamentos (se o IG mandar; -1 = não veio)
    pub taken_at: i64,
    pub caption: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Comment {
    pub user: IgUser,
    pub text: String,
    pub likes: i64,
    pub created_at: i64,
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
            // IG serviu a PAGINA (HTML) em vez de JSON num endpoint de API:
            // shell "not-logged-in" = sessao caida (ds_user_id sobrevive ao logout, engana o pre-check);
            // qualquer HTML aqui = deslogado/checkpoint. Trata como LOGIN (o front mostra "faca login").
            {
                let low = body.trim_start().to_ascii_lowercase();
                if low.contains("not-logged-in")
                    || low.contains("not_logged_in")
                    || low.starts_with("<!doctype html")
                    || low.starts_with("<html")
                {
                    return Err(LOGIN.into());
                }
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
                // inclui um trecho do corpo real (o IG diz a verdade no JSON — lição de julho)
                let peek: String = body.chars().take(180).collect();
                return Err(format!("HTTP {status}: {peek}"));
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

/// Anda o JSON inteiro e junta QUALQUER objeto que pareca um user (tem "username" + "pk").
/// Uso: endpoints nao-documentados (reshares/reposts) cujo formato de resposta nao conheco.
fn harvest_users(j: &serde_json::Value, out: &mut Vec<IgUser>, seen: &mut std::collections::HashSet<String>) {
    match j {
        serde_json::Value::Object(m) => {
            if m.contains_key("username") && (m.contains_key("pk") || m.contains_key("pk_id") || m.contains_key("id")) {
                let pk = m.get("pk").or_else(|| m.get("pk_id")).or_else(|| m.get("id"))
                    .map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.as_i64().map(|n| n.to_string()).unwrap_or_default()))
                    .unwrap_or_default();
                let username = m.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if !username.is_empty() && seen.insert(if pk.is_empty() { username.clone() } else { pk.clone() }) {
                    out.push(IgUser {
                        pk,
                        username,
                        full: m.get("full_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        is_private: m.get("is_private").and_then(|v| v.as_bool()).unwrap_or(false),
                        is_verified: m.get("is_verified").and_then(|v| v.as_bool()).unwrap_or(false),
                    });
                }
            }
            for v in m.values() {
                harvest_users(v, out, seen);
            }
        }
        serde_json::Value::Array(a) => {
            for v in a {
                harvest_users(v, out, seen);
            }
        }
        _ => {}
    }
}

/// Quem RECOMPARTILHOU o post no story (endpoint NAO-documentado + efemero: so stories ATIVOS
/// <24h, conta profissional, contas publicas). Tenta os caminhos plausiveis sozinho (sem captura
/// manual). Devolve (users, tentou_ok) — vazio nao e erro, e "ninguem ativo agora".
pub async fn reshares(
    app: &tauri::AppHandle,
    s: &Session,
    media_id: &str,
) -> Result<Vec<IgUser>, String> {
    if media_id.is_empty() || !media_id.chars().all(|c| c.is_ascii_digit() || c == '_') {
        return Err("media_id invalido".into());
    }
    // candidatos observados/plausiveis pro "ver recompartilhamentos"
    let paths = [
        format!("https://www.instagram.com/api/v1/media/{media_id}/story_reshares/"),
        format!("https://www.instagram.com/api/v1/media/{media_id}/reshares/"),
        format!("https://www.instagram.com/api/v1/media/{media_id}/resharers/"),
    ];
    let mut users = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for url in &paths {
        if let Ok(j) = webview_fetch(app, url, false, &s.csrf).await {
            // ignora resposta de erro/login; so colhe users
            if j["status"].as_str() != Some("fail") {
                harvest_users(&j, &mut users, &mut seen);
            }
            if !users.is_empty() {
                break; // achou um endpoint que responde com gente
            }
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(500))).await;
    }
    Ok(users)
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

/// Uma pagina do feed proprio + cursor pra proxima (scroll pra posts antigos).
#[derive(serde::Serialize)]
pub struct FeedPage {
    pub items: Vec<Post>,
    pub next: String, // "" = acabou
}

/// Ultimos posts proprios (likes/coments/views publicos) pro Relatorio.
pub async fn feed(app: &tauri::AppHandle, s: &Session, count: u32) -> Result<Vec<Post>, String> {
    Ok(feed_page(app, s, count, "").await?.items)
}

/// Pagina do feed a partir de `max_id` ("" = 1a pagina). Devolve items + next cursor.
pub async fn feed_page(
    app: &tauri::AppHandle,
    s: &Session,
    count: u32,
    max_id: &str,
) -> Result<FeedPage, String> {
    let url = format!(
        "https://www.instagram.com/api/v1/feed/user/{}/?count={count}{}",
        s.ds,
        if max_id.is_empty() { String::new() } else { format!("&max_id={max_id}") }
    );
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    let next = if j["more_available"].as_bool().unwrap_or(false) {
        j["next_max_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_max_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let items = j["items"]
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
                    // nº de compart./salvos SE o IG mandar no dado do post (sem endpoint extra); -1 = não veio
                    reshares: it["reshare_count"].as_i64().or_else(|| it["share_count"].as_i64()).unwrap_or(-1),
                    saves: it["save_count"].as_i64().or_else(|| it["saved_count"].as_i64()).unwrap_or(-1),
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
        .unwrap_or_default();
    Ok(FeedPage { items, next })
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
    // pagina enquanto o IG der next_max_id (puxa o máximo — o counter conta mais do que a
    // lista às vezes; ao menos garante que não paramos na 1ª página).
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut next = String::new();
    for _ in 0..40 {
        let url = if next.is_empty() {
            format!("https://www.instagram.com/api/v1/media/{media_id}/likers/")
        } else {
            format!("https://www.instagram.com/api/v1/media/{media_id}/likers/?max_id={next}")
        };
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        for u in parse_users(&j) {
            if seen.insert(u.pk.clone()) {
                out.push(u);
            }
        }
        next = j["next_max_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_max_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        if next.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(600))).await;
    }
    Ok(out)
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
    // parseia 1 objeto de comentario da API -> Comment (prefixa respostas p/ dar contexto)
    let parse_comment = |c: &serde_json::Value, reply: bool| -> Comment {
        let u = &c["user"];
        let txt: String = c["text"].as_str().unwrap_or("").chars().take(280).collect();
        Comment {
            user: IgUser {
                pk: u["pk"].as_str().map(String::from).unwrap_or_else(|| {
                    u["pk"].as_i64().map(|n| n.to_string()).unwrap_or_default()
                }),
                username: u["username"].as_str().unwrap_or("").to_string(),
                full: u["full_name"].as_str().unwrap_or("").to_string(),
                is_private: u["is_private"].as_bool().unwrap_or(false),
                is_verified: u["is_verified"].as_bool().unwrap_or(false),
            },
            text: if reply { format!("[resp] {txt}") } else { txt },
            likes: c["comment_like_count"].as_i64().unwrap_or(0),
            created_at: c["created_at"].as_i64().or_else(|| c["created_at_utc"].as_i64()).unwrap_or(0),
        }
    };

    let mut out = Vec::new();
    let mut reply_pks: Vec<String> = Vec::new(); // comentarios pai que TEM respostas
    let mut next = String::new();
    for _ in 0..60 {
        // threading=true -> a API devolve child_comment_count (senao nao da p/ saber quem tem resposta).
        // Pagina p/ TRAS (comentarios mais antigos) via max_id/next_max_id. (min_id carrega os mais
        // NOVOS, nao existem -> parava na 1a pagina; era a causa do 31 virar ~15.)
        let url = format!(
            "https://www.instagram.com/api/v1/media/{media_id}/comments/?can_support_threading=true&permalink_enabled=false{}",
            if next.is_empty() {
                String::new()
            } else {
                format!("&max_id={next}")
            }
        );
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        if let Some(arr) = j["comments"].as_array() {
            for c in arr {
                out.push(parse_comment(c, false));
                if c["child_comment_count"].as_i64().unwrap_or(0) > 0 {
                    if let Some(pk) = c["pk"].as_str().map(String::from).or_else(|| c["pk"].as_i64().map(|n| n.to_string())) {
                        reply_pks.push(pk);
                    }
                }
            }
        }
        next = j["next_max_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_max_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        let has_more = j["has_more_comments"].as_bool().unwrap_or(false);
        if next.is_empty() && !has_more {
            break;
        }
        if next.is_empty() {
            break; // sem cursor nao da p/ avancar mesmo com has_more
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(600))).await;
    }

    // busca as RESPOSTAS de cada comentario que tem filhos (fecha o gap do counter, que soma replies)
    for pk in reply_pks.iter().take(60) {
        let mut cnext = String::new();
        for _ in 0..20 {
            let url = format!(
                "https://www.instagram.com/api/v1/media/{media_id}/comments/{pk}/child_comments/{}",
                if cnext.is_empty() { String::new() } else { format!("?max_id={cnext}") }
            );
            let j = match webview_fetch(app, &url, false, &s.csrf).await {
                Ok(v) => v,
                Err(_) => break, // se um pai falhar, segue os outros
            };
            if let Some(arr) = j["child_comments"].as_array() {
                for c in arr {
                    out.push(parse_comment(c, true));
                }
            }
            cnext = j["next_max_child_cursor"]
                .as_str()
                .map(String::from)
                .or_else(|| j["next_max_id"].as_str().map(String::from))
                .unwrap_or_default();
            if cnext.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(jitter_ms(500))).await;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(500))).await;
    }
    Ok(out)
}

/// Contagem AO VIVO de um post (like/comment/reshare/save) — o feed traz numero cacheado,
/// isso busca o atual (posts ganham interacao depois). /media/{id}/info/.
#[derive(serde::Serialize)]
pub struct MediaCounts {
    pub like: i64,
    pub cmt: i64,
    pub reshares: i64,
    pub saves: i64,
}

pub async fn media_info(
    app: &tauri::AppHandle,
    s: &Session,
    media_id: &str,
) -> Result<MediaCounts, String> {
    if media_id.is_empty() || !media_id.chars().all(|c| c.is_ascii_digit() || c == '_') {
        return Err("media_id invalido".into());
    }
    let url = format!("https://www.instagram.com/api/v1/media/{media_id}/info/");
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    let it = &j["items"][0];
    Ok(MediaCounts {
        like: it["like_count"].as_i64().unwrap_or(-1),
        cmt: it["comment_count"].as_i64().unwrap_or(-1),
        reshares: it["reshare_count"].as_i64().or_else(|| it["share_count"].as_i64()).unwrap_or(-1),
        saves: it["save_count"].as_i64().or_else(|| it["saved_count"].as_i64()).unwrap_or(-1),
    })
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

/// Um item dos SALVOS (pro roteador de conhecimento -> vault). So o que a sessao logada
/// da: a lista. Frames/transcricao/roteamento sao o passo de absorcao da IA (fora do app).
#[derive(Debug, Clone, Serialize)]
pub struct SavedItem {
    pub code: String,     // shortcode -> link do reel/post
    pub media_id: String, // pk/id (referencia)
    pub is_video: bool,
    pub thumb: String,      // url da capa
    pub caption: String,    // legenda (ate 400 chars — a IA classifica o tema por ela)
    pub taken_at: i64,
    pub collection: String, // nome da colecao IG (se veio de uma) — dica de tema "de graca"
}

/// Extrai um SavedItem do objeto `media` do IG (funciona pra saved feed e colecao).
fn parse_saved_media(m: &serde_json::Value, collection: &str) -> SavedItem {
    let media_type = m["media_type"].as_i64().unwrap_or(0);
    let thumb = m["image_versions2"]["candidates"]
        .as_array()
        .and_then(|c| c.last())
        .and_then(|c| c["url"].as_str())
        .or_else(|| {
            m["carousel_media"][0]["image_versions2"]["candidates"]
                .as_array()
                .and_then(|c| c.last())
                .and_then(|c| c["url"].as_str())
        })
        .unwrap_or("")
        .to_string();
    SavedItem {
        code: m["code"].as_str().unwrap_or("").to_string(),
        media_id: m["id"].as_str().map(String::from).unwrap_or_else(|| {
            m["pk"].as_str().map(String::from).unwrap_or_else(|| {
                m["pk"].as_i64().map(|n| n.to_string()).unwrap_or_default()
            })
        }),
        is_video: media_type == 2,
        thumb,
        caption: m["caption"]["text"].as_str().unwrap_or("").chars().take(400).collect(),
        taken_at: m["taken_at"].as_i64().unwrap_or(0),
        collection: collection.to_string(),
    }
}

/// Parseia items de um feed de salvos/colecao: cada item embrulha `media` (senao e o proprio).
fn parse_saved_items(j: &serde_json::Value, collection: &str, out: &mut Vec<SavedItem>) {
    if let Some(arr) = j["items"].as_array() {
        for it in arr {
            let m = if it.get("media").is_some() { &it["media"] } else { it };
            let s = parse_saved_media(m, collection);
            if !s.code.is_empty() {
                out.push(s);
            }
        }
    }
}

/// Emite progresso do "puxar salvos" pro front (tela de transferencia: N de TOTAL + item atual).
fn emit_saved_progress(app: &tauri::AppHandle, count: usize, total: i64, last: Option<&SavedItem>) {
    let payload = serde_json::json!({
        "count": count,
        "total": total, // 0 = desconhecido (todos os salvos); >0 = tamanho da colecao
        "code": last.map(|i| i.code.as_str()).unwrap_or(""),
        "caption": last.map(|i| i.caption.as_str()).unwrap_or(""),
        "thumb": last.map(|i| i.thumb.as_str()).unwrap_or(""),
        "is_video": last.map(|i| i.is_video).unwrap_or(false),
    });
    let _ = app.emit("saved_progress", payload);
}

/// DEBUG: grava linha no log de salvos (%TEMP%\codexig-saved.log) — eu leio o arquivo.
fn dbg_saved(msg: &str) {
    use std::io::Write;
    let p = std::env::temp_dir().join("codexig-saved.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{msg}");
    }
}

/// Resultado de um chunk de salvos: itens + cursor pra continuar + se o IG limitou.
#[derive(serde::Serialize)]
pub struct SavedResult {
    pub items: Vec<SavedItem>,
    pub next: String,     // "" = acabou; senao = passa em resume pra continuar
    pub throttled: bool,  // IG limitou no meio (parcial devolvido; espere e continue)
}

/// Pagina UM endpoint de salvos a partir de `start` (cursor). Devolve ate ~12 paginas.
/// NAO perde o parcial: se o IG limitar DEPOIS de ja termos itens, devolve o que tem + cursor.
/// So propaga erro se falhar LOGO na 1a pagina sem nada (login real / endpoint errado).
async fn saved_paginate(app: &tauri::AppHandle, s: &Session, base: &str, start: &str, total: i64) -> Result<SavedResult, String> {
    let mut out = Vec::new();
    let mut next = start.to_string();
    let mut throttled = false;
    for page in 0..12 {
        let sep = if base.contains('?') { "&" } else { "?" };
        let url = format!(
            "{base}{sep}count=50{}",
            if next.is_empty() { String::new() } else { format!("&max_id={next}") }
        );
        dbg_saved(&format!("  -> GET pg{page} {url}"));
        let j = match webview_fetch(app, &url, false, &s.csrf).await {
            Ok(v) => v,
            Err(e) => {
                dbg_saved(&format!("  <- ERR {e}"));
                if out.is_empty() && page == 0 {
                    return Err(e); // nada ainda: login real ou endpoint errado -> deixa o chamador tratar
                }
                throttled = true; // ja temos itens: IG limitou no meio -> parcial + cursor pra continuar
                break;
            }
        };
        let before = out.len();
        parse_saved_items(&j, "", &mut out);
        next = j["next_max_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_max_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        let more = j["more_available"].as_bool().unwrap_or(false);
        dbg_saved(&format!("  <- +{} (tot {}) more={} next='{}'", out.len() - before, out.len(), more, next));
        emit_saved_progress(app, out.len(), total, out.last()); // tela de transferencia
        if next.is_empty() || !more {
            next = String::new();
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(1500))).await; // ritmo lento anti-throttle
    }
    Ok(SavedResult { items: out, next, throttled })
}

/// Lista TODOS os salvos. O endpoint web varia — tenta candidatos em ordem; o 1º que NAO
/// der erro (200) vence (mesmo vazio = conta sem salvos). So troca de candidato em erro.
pub async fn saved_feed(app: &tauri::AppHandle, s: &Session, resume: &str) -> Result<SavedResult, String> {
    const SAVED: &str = "https://www.instagram.com/api/v1/feed/saved/posts/";
    dbg_saved(&format!("=== saved_feed inicio (resume='{}') ===", resume));
    // continuando um chunk anterior: endpoint ja conhecido, so pagina de onde parou.
    if !resume.is_empty() {
        return saved_paginate(app, s, SAVED, resume, 0).await;
    }
    // 1a vez: tenta candidatos (o /posts/ e o que responde; os outros sao fallback).
    let bases = [
        SAVED,
        "https://www.instagram.com/api/v1/feed/saved/",
        "https://www.instagram.com/api/v1/feed/collection/ALL_MEDIA_AUTO_COLLECTION/posts/",
    ];
    let mut last_err = String::from("nenhum endpoint de salvos respondeu");
    for base in bases {
        dbg_saved(&format!("[candidato] {base}"));
        match saved_paginate(app, s, base, "", 0).await {
            Ok(r) => { dbg_saved(&format!("[OK] {base} -> {} itens next='{}' throttled={}", r.items.len(), r.next, r.throttled)); return Ok(r); }
            Err(e) => { dbg_saved(&format!("[FAIL] {base} -> {e}")); last_err = e; }
        }
    }
    dbg_saved(&format!("=== saved_feed fim SEM sucesso: {last_err} ==="));
    Err(last_err)
}

/// As colecoes de salvos do usuario (nome = dica de tema). `/api/v1/collections/list/`.
pub async fn collections_list(app: &tauri::AppHandle, s: &Session) -> Result<Vec<serde_json::Value>, String> {
    let url = "https://www.instagram.com/api/v1/collections/list/?collection_types=[\"MEDIA\"]".to_string();
    let j = webview_fetch(app, &url, false, &s.csrf).await?;
    let out = j["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| {
                    serde_json::json!({
                        "id": c["collection_id"].as_str().map(String::from)
                            .or_else(|| c["collection_id"].as_i64().map(|n| n.to_string()))
                            .unwrap_or_default(),
                        "name": c["collection_name"].as_str().unwrap_or("").to_string(),
                        "count": c["collection_media_count"].as_i64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(out)
}

/// Itens de UMA colecao (o nome vira o tema). `/api/v1/feed/collection/{id}/posts/`.
pub async fn collection_feed(
    app: &tauri::AppHandle,
    s: &Session,
    collection_id: &str,
    collection_name: &str,
    total: i64,
) -> Result<Vec<SavedItem>, String> {
    if collection_id.is_empty() || !collection_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("collection_id invalido".into());
    }
    let mut out = Vec::new();
    let mut next = String::new();
    for _ in 0..120 {
        let url = format!(
            "https://www.instagram.com/api/v1/feed/collection/{collection_id}/posts/?count=50{}",
            if next.is_empty() { String::new() } else { format!("&max_id={next}") }
        );
        let j = webview_fetch(app, &url, false, &s.csrf).await?;
        parse_saved_items(&j, collection_name, &mut out);
        emit_saved_progress(app, out.len(), total, out.last()); // tela de transferencia
        next = j["next_max_id"]
            .as_str()
            .map(String::from)
            .or_else(|| j["next_max_id"].as_i64().map(|n| n.to_string()))
            .unwrap_or_default();
        if next.is_empty() || !j["more_available"].as_bool().unwrap_or(false) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(jitter_ms(900))).await;
    }
    Ok(out)
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
