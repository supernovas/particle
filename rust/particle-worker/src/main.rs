mod config;
mod github;
mod journal;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use particle_core::{fold, is_converged, new_id, next_clock, Clock, ParticleEvent, TaskStatus};
use serde_json::json;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::github::{Cursor, IssueChannel, Prompt, Tokens};
use crate::journal::Journal;

const STATE_DIR: &str = ".particle";

struct ProjectLog {
    id: String,
    events: Vec<ParticleEvent>,
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("RFC3339 formatting")
}

fn last_clock(log: &ProjectLog) -> Option<&Clock> {
    log.events.last().map(|e| &e.clock)
}

fn push_event(log: &mut ProjectLog, kind: &str, actor: String, data: serde_json::Value) {
    let clock = next_clock(last_clock(log), &[], now_iso());
    let parents = log
        .events
        .last()
        .map(|e| vec![e.id.clone()])
        .unwrap_or_default();
    log.events.push(ParticleEvent {
        v: 0,
        id: new_id("evt"),
        kind: kind.to_string(),
        project: log.id.clone(),
        actor,
        clock,
        parents,
        data,
    });
}

fn prompt_to_events(log: &mut ProjectLog, prompt: &Prompt, is_new: bool) -> Vec<ParticleEvent> {
    let before = log.events.len();
    let actor = format!("github:{}", prompt.author);
    if is_new {
        let repo = prompt
            .url
            .split("/issues/")
            .next()
            .unwrap_or_default()
            .trim_start_matches("https://github.com/")
            .to_string();
        push_event(
            log,
            "project.created",
            actor.clone(),
            json!({
                "title": prompt.issue_title,
                "source": {"kind": "github-issue", "repo": repo, "number": prompt.issue_number}
            }),
        );
    }
    push_event(
        log,
        "message.posted",
        actor,
        json!({"body": prompt.body, "via": prompt.url}),
    );
    log.events[before..].to_vec()
}

fn load_cursor(path: &Path) -> Result<Cursor> {
    if !path.exists() {
        return Ok(Cursor::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

/// Write-then-rename so a crash mid-write can never leave a torn cursor file.
/// (A crash between journal append and this save still re-emits prompts as
/// duplicate events on restart — that window closes with the CAS ref store,
/// P1.T3.)
fn save_cursor(path: &Path, cursor: &Cursor) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(cursor)? + "\n")?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn print_summary(key: &str, log: &ProjectLog) {
    let state = fold(&log.id, &log.events);
    let done = state
        .tasks
        .values()
        .filter(|t| t.status == TaskStatus::Done)
        .count();
    println!(
        "[{key}] \"{}\" msgs={} tasks={done}/{} status={}{}",
        state.title,
        state.messages.len(),
        state.tasks.len(),
        state.status,
        if is_converged(&state) {
            " ✓ converged"
        } else {
            ""
        }
    );
}

#[tokio::main]
async fn main() -> Result<()> {
    let once = std::env::args().any(|a| a == "--once");
    let state_dir = PathBuf::from(STATE_DIR);
    let config = config::load_config(Path::new("particle.yaml"))?;
    let creds = github::load_app_creds(&state_dir)?;
    let owner = config
        .host
        .repo
        .split('/')
        .next()
        .context("host.repo owner")?
        .to_string();
    let gh = &config.channels.github_issues;
    let channel = IssueChannel {
        repo: gh.repo.clone().unwrap_or_else(|| config.host.repo.clone()),
        label: gh.label.clone(),
        seed_issues: gh.seed_issues.clone(),
    };
    let poll_interval = Duration::from_secs(gh.poll_interval_seconds);
    let mut tokens = Tokens::new(creds, owner)?;

    println!(
        "particle-worker (rust) v0 — host {}, app {} (#{})",
        config.host.repo,
        tokens.slug(),
        tokens.app_id()
    );

    let journal = Journal::new(state_dir.join("journal.ndjson"))?;
    let cursor_path = state_dir.join("cursor.json");

    // Replay the journal so restarts continue where the log left off. The
    // journal format is shared with the TypeScript worker.
    let mut projects: BTreeMap<String, ProjectLog> = BTreeMap::new();
    for event in journal.load()? {
        if event.kind == "project.created" {
            if let Some(number) = event.data["source"]["number"].as_u64() {
                projects.insert(
                    format!("gh-{number}"),
                    ProjectLog {
                        id: event.project.clone(),
                        events: vec![],
                    },
                );
            }
        }
        for log in projects.values_mut() {
            if log.id == event.project {
                log.events.push(event.clone());
            }
        }
    }
    if !projects.is_empty() {
        println!("replayed journal: {} project(s)", projects.len());
    }

    let mut cursor = load_cursor(&cursor_path)?;

    loop {
        match channel.poll(&mut tokens, &cursor).await {
            Ok((prompts, next_cursor)) => {
                cursor = next_cursor;
                let mut fresh: Vec<ParticleEvent> = Vec::new();
                let mut touched: Vec<String> = Vec::new();
                for prompt in &prompts {
                    let is_new = !projects.contains_key(&prompt.project_key);
                    let log = projects
                        .entry(prompt.project_key.clone())
                        .or_insert_with(|| ProjectLog {
                            id: new_id("prj"),
                            events: vec![],
                        });
                    fresh.extend(prompt_to_events(log, prompt, is_new));
                    if !touched.contains(&prompt.project_key) {
                        touched.push(prompt.project_key.clone());
                    }
                }
                journal.append(&fresh)?;
                save_cursor(&cursor_path, &cursor)?;
                for key in &touched {
                    print_summary(key, &projects[key]);
                }
            }
            Err(err) => eprintln!("poll failed: {err:#}"),
        }

        if once {
            break;
        }
        tokio::select! {
            _ = tokio::time::sleep(poll_interval) => {}
            _ = tokio::signal::ctrl_c() => {
                println!("\nstopping…");
                break;
            }
        }
    }
    Ok(())
}
