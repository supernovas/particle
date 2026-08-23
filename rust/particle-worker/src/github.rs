use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const API: &str = "https://api.github.com";

#[derive(Debug, Deserialize)]
pub struct AppMeta {
    pub id: u64,
    pub slug: String,
    pub client_id: String,
}

pub struct AppCreds {
    pub meta: AppMeta,
    pem: Vec<u8>,
}

pub fn load_app_creds(dir: &Path) -> Result<AppCreds> {
    let meta_path = dir.join("github-app.json");
    let pem_path = dir.join("github-app.private-key.pem");
    let hint = "run `node scripts/create-github-app.mjs <org>` first";
    let meta: AppMeta = serde_json::from_str(
        &fs::read_to_string(&meta_path)
            .with_context(|| format!("reading {} — {hint}", meta_path.display()))?,
    )
    .with_context(|| format!("parsing {}", meta_path.display()))?;
    let pem =
        fs::read(&pem_path).with_context(|| format!("reading {} — {hint}", pem_path.display()))?;
    Ok(AppCreds { meta, pem })
}

#[derive(Serialize)]
struct JwtClaims {
    iat: u64,
    exp: u64,
    iss: String,
}

fn app_jwt(creds: &AppCreds) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let claims = JwtClaims {
        iat: now - 60,
        exp: now + 540,
        iss: creds.meta.client_id.clone(),
    };
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(&creds.pem)
        .context("github-app.private-key.pem is not a valid RSA key")?;
    Ok(jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &key,
    )?)
}

/// Caches an installation token and refreshes it shortly before expiry.
pub struct Tokens {
    creds: AppCreds,
    owner: String,
    http: reqwest::Client,
    cached: Option<(String, SystemTime)>,
    installation_id: Option<u64>,
}

impl Tokens {
    pub fn new(creds: AppCreds, owner: String) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent("particle-worker")
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Tokens {
            creds,
            owner,
            http,
            cached: None,
            installation_id: None,
        })
    }

    pub fn slug(&self) -> &str {
        &self.creds.meta.slug
    }

    pub fn app_id(&self) -> u64 {
        self.creds.meta.id
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub async fn get(&mut self) -> Result<String> {
        if let Some((token, expires)) = &self.cached {
            if expires
                .duration_since(SystemTime::now())
                .map(|d| d > Duration::from_secs(300))
                .unwrap_or(false)
            {
                return Ok(token.clone());
            }
        }
        let jwt = app_jwt(&self.creds)?;
        if self.installation_id.is_none() {
            let installs: Vec<Value> = gh_json(
                &self.http,
                &jwt,
                reqwest::Method::GET,
                "/app/installations",
                None,
            )
            .await?;
            let install = installs
                .iter()
                .find(|i| i["account"]["login"] == self.owner.as_str())
                .or_else(|| installs.first())
                .with_context(|| format!("app {} has no installations", self.creds.meta.slug))?;
            self.installation_id = install["id"].as_u64();
        }
        let id = self.installation_id.context("installation id missing")?;
        let tok: Value = gh_json(
            &self.http,
            &jwt,
            reqwest::Method::POST,
            &format!("/app/installations/{id}/access_tokens"),
            None,
        )
        .await?;
        let token = tok["token"]
            .as_str()
            .context("no token in response")?
            .to_string();
        // Tokens last an hour; refresh-side margin is handled above.
        let expires = SystemTime::now() + Duration::from_secs(3600);
        self.cached = Some((token.clone(), expires));
        Ok(token)
    }
}

async fn gh_json<T: serde::de::DeserializeOwned>(
    http: &reqwest::Client,
    bearer: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<T> {
    let mut req = http
        .request(method.clone(), format!("{API}{path}"))
        .bearer_auth(bearer)
        .header("accept", "application/vnd.github+json");
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        bail!(
            "{method} {path}: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        );
    }
    Ok(res.json().await?)
}

/// A human utterance pulled from the channel, not yet a particle event.
#[derive(Debug)]
pub struct Prompt {
    pub project_key: String,
    pub issue_number: u64,
    pub issue_title: String,
    pub author: String,
    pub body: String,
    pub url: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Cursor {
    /// Per issue number: highest comment id already turned into a prompt.
    pub issues: BTreeMap<String, IssueCursor>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueCursor {
    pub last_comment_id: u64,
}

/// Read side of the #github-issues channel (SPEC §7). Comments authored by our
/// own app are never prompts — that's the loop guard.
pub struct IssueChannel {
    pub repo: String,
    pub label: String,
    pub seed_issues: Vec<u64>,
}

impl IssueChannel {
    fn is_self(user: &Value, bot_slug: &str) -> bool {
        user["type"] == "Bot" && user["login"] == format!("{bot_slug}[bot]")
    }

    pub async fn poll(
        &self,
        tokens: &mut Tokens,
        cursor: &Cursor,
    ) -> Result<(Vec<Prompt>, Cursor)> {
        let token = tokens.get().await?;
        let bot_slug = tokens.slug().to_string();
        let http = tokens.http().clone();

        let mut issues: BTreeMap<u64, Value> = BTreeMap::new();
        // Phase-0 limitation carried over from the TS worker: single-page
        // listings (100 items); Link-header pagination lands with P1.T4.
        let labeled: Vec<Value> = gh_json(
            &http,
            &token,
            reqwest::Method::GET,
            &format!(
                "/repos/{}/issues?state=open&labels={}&per_page=100",
                self.repo,
                urlencode(&self.label)
            ),
            None,
        )
        .await?;
        for issue in labeled {
            if issue["pull_request"].is_null() {
                if let Some(n) = issue["number"].as_u64() {
                    issues.insert(n, issue);
                }
            }
        }
        for &n in &self.seed_issues {
            if let std::collections::btree_map::Entry::Vacant(entry) = issues.entry(n) {
                let issue: Value = gh_json(
                    &http,
                    &token,
                    reqwest::Method::GET,
                    &format!("/repos/{}/issues/{n}", self.repo),
                    None,
                )
                .await?;
                if issue["pull_request"].is_null() {
                    entry.insert(issue);
                }
            }
        }

        let mut prompts = Vec::new();
        let mut next = Cursor::default();
        for (k, v) in &cursor.issues {
            next.issues.insert(
                k.clone(),
                IssueCursor {
                    last_comment_id: v.last_comment_id,
                },
            );
        }

        for (number, issue) in &issues {
            let key = number.to_string();
            let known = cursor.issues.get(&key);
            let title = issue["title"].as_str().unwrap_or_default().to_string();
            if known.is_none() {
                // First sighting: the issue body is the founding prompt.
                prompts.push(Prompt {
                    project_key: format!("gh-{number}"),
                    issue_number: *number,
                    issue_title: title.clone(),
                    author: issue["user"]["login"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    body: issue["body"].as_str().unwrap_or_default().to_string(),
                    url: issue["html_url"].as_str().unwrap_or_default().to_string(),
                });
            }
            let mut last_comment_id = known.map(|c| c.last_comment_id).unwrap_or(0);
            if issue["comments"].as_u64().unwrap_or(0) > 0 {
                let comments: Vec<Value> = gh_json(
                    &http,
                    &token,
                    reqwest::Method::GET,
                    &format!("/repos/{}/issues/{number}/comments?per_page=100", self.repo),
                    None,
                )
                .await?;
                for comment in &comments {
                    let id = comment["id"].as_u64().unwrap_or(0);
                    if id <= last_comment_id {
                        continue;
                    }
                    last_comment_id = last_comment_id.max(id);
                    if Self::is_self(&comment["user"], &bot_slug) {
                        continue;
                    }
                    prompts.push(Prompt {
                        project_key: format!("gh-{number}"),
                        issue_number: *number,
                        issue_title: title.clone(),
                        author: comment["user"]["login"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                        body: comment["body"].as_str().unwrap_or_default().to_string(),
                        url: comment["html_url"].as_str().unwrap_or_default().to_string(),
                    });
                }
            }
            next.issues.insert(key, IssueCursor { last_comment_id });
        }

        Ok((prompts, next))
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}
