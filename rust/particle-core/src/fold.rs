use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::clock::compare_events;
use crate::event::ParticleEvent;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageState {
    pub id: String,
    pub actor: String,
    pub body: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    Claimed,
    InProgress,
    Blocked,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub id: String,
    pub title: String,
    pub spec: String,
    pub deps: Vec<String>,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub verdict: String,
    pub by: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Value>,
    pub messages: Vec<MessageState>,
    pub tasks: BTreeMap<String, TaskState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_review: Option<ReviewState>,
    pub artifacts: Vec<Value>,
    /// Highest lamport clock folded in.
    pub clock: u64,
    /// Ids of all folded events, for dedupe and causal parents.
    #[serde(skip)]
    pub seen: BTreeSet<String>,
}

impl ProjectState {
    pub fn empty(project_id: &str) -> Self {
        ProjectState {
            id: project_id.to_string(),
            title: String::new(),
            status: "open".to_string(),
            source: None,
            messages: Vec::new(),
            tasks: BTreeMap::new(),
            last_review: None,
            artifacts: Vec::new(),
            clock: 0,
            seen: BTreeSet::new(),
        }
    }
}

/// Deterministically fold a set of events into project state. Events are
/// sorted into the canonical total order first, and duplicate ids are ignored,
/// so any replica with the same *set* of events computes the same state
/// (SPEC §4.2). Events whose payload does not match their declared type are
/// skipped whole — never partially applied.
pub fn fold(project_id: &str, events: &[ParticleEvent]) -> ProjectState {
    let mut sorted: Vec<&ParticleEvent> = events.iter().collect();
    sorted.sort_by(|a, b| compare_events(a, b));
    let mut state = ProjectState::empty(project_id);
    for event in sorted {
        apply(&mut state, event);
    }
    state
}

/// A project has reached its fixed point when every task is done and the most
/// recent review approves (SPEC §8).
pub fn is_converged(state: &ProjectState) -> bool {
    if state.tasks.is_empty() {
        return false;
    }
    if !state.tasks.values().all(|t| t.status == TaskStatus::Done) {
        return false;
    }
    state
        .last_review
        .as_ref()
        .is_some_and(|r| r.verdict == "approve")
}

#[derive(Deserialize)]
struct ProjectCreated {
    title: String,
    source: Value,
}

#[derive(Deserialize)]
struct MessagePosted {
    body: String,
    via: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreated {
    task_id: String,
    title: String,
    spec: String,
    deps: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRef {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdated {
    task_id: String,
    status: TaskStatus,
}

#[derive(Deserialize)]
struct ReviewPosted {
    verdict: String,
}

#[derive(Deserialize)]
struct ProjectStatusChanged {
    status: String,
}

fn apply(state: &mut ProjectState, event: &ParticleEvent) {
    if event.project != state.id || state.seen.contains(&event.id) {
        return;
    }
    state.seen.insert(event.id.clone());
    if event.clock.lamport > state.clock {
        state.clock = event.clock.lamport;
    }

    match event.kind.as_str() {
        "project.created" => {
            if let Ok(data) = serde_json::from_value::<ProjectCreated>(event.data.clone()) {
                state.title = data.title;
                state.source = Some(data.source);
            }
        }
        "message.posted" => {
            if let Ok(data) = serde_json::from_value::<MessagePosted>(event.data.clone()) {
                state.messages.push(MessageState {
                    id: event.id.clone(),
                    actor: event.actor.clone(),
                    body: data.body,
                    at: event.clock.wall.clone(),
                    via: data.via,
                });
            }
        }
        "task.created" => {
            if let Ok(data) = serde_json::from_value::<TaskCreated>(event.data.clone()) {
                state
                    .tasks
                    .entry(data.task_id.clone())
                    .or_insert(TaskState {
                        id: data.task_id,
                        title: data.title,
                        spec: data.spec,
                        deps: data.deps,
                        status: TaskStatus::Open,
                        assignee: None,
                    });
            }
        }
        "task.claimed" => {
            if let Ok(data) = serde_json::from_value::<TaskRef>(event.data.clone()) {
                if let Some(task) = state.tasks.get_mut(&data.task_id) {
                    // First claim in canonical order wins; claims on a held
                    // task are no-ops.
                    if task.status == TaskStatus::Open {
                        task.status = TaskStatus::Claimed;
                        task.assignee = Some(event.actor.clone());
                    }
                }
            }
        }
        "task.updated" => {
            if let Ok(data) = serde_json::from_value::<TaskUpdated>(event.data.clone()) {
                if let Some(task) = state.tasks.get_mut(&data.task_id) {
                    if task.assignee.as_deref() == Some(event.actor.as_str()) {
                        task.status = data.status;
                    }
                }
            }
        }
        "review.posted" => {
            if let Ok(data) = serde_json::from_value::<ReviewPosted>(event.data.clone()) {
                state.last_review = Some(ReviewState {
                    verdict: data.verdict,
                    by: event.actor.clone(),
                    at: event.clock.wall.clone(),
                });
            }
        }
        "artifact.linked" => {
            state.artifacts.push(event.data.clone());
        }
        "project.status" => {
            if let Ok(data) = serde_json::from_value::<ProjectStatusChanged>(event.data.clone()) {
                state.status = data.status;
            }
        }
        _ => {}
    }
}
