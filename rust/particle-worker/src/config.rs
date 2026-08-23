use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub host: Host,
    #[serde(default)]
    pub channels: Channels,
}

#[derive(Debug, Deserialize)]
pub struct Host {
    pub repo: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct Channels {
    #[serde(rename = "github-issues", default)]
    pub github_issues: GithubIssues,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct GithubIssues {
    pub repo: Option<String>,
    pub label: String,
    #[serde(rename = "seed-issues")]
    pub seed_issues: Vec<u64>,
    #[serde(rename = "poll-interval-seconds")]
    pub poll_interval_seconds: u64,
    pub mirror: bool,
}

impl Default for GithubIssues {
    fn default() -> Self {
        GithubIssues {
            repo: None,
            label: "particle:project".to_string(),
            seed_issues: vec![],
            poll_interval_seconds: 15,
            mirror: false,
        }
    }
}

pub fn load_config(path: &Path) -> Result<Config> {
    let raw = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let mut config: Config =
        serde_yaml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))?;
    if !config.host.repo.contains('/') {
        bail!("{}: host.repo must be \"owner/name\"", path.display());
    }
    if config.channels.github_issues.poll_interval_seconds == 0 {
        config.channels.github_issues.poll_interval_seconds = 15;
    }
    Ok(config)
}
