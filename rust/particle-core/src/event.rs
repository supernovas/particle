use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clock {
    /// Lamport clock: max(observed) + 1 at append time. Primary ordering key.
    pub lamport: u64,
    /// Wall time in ISO 8601 UTC. Informational only — never used for ordering.
    pub wall: String,
}

/// The envelope every particle event shares (SPEC §4). The type stays a plain
/// string and the payload stays raw JSON so unknown event types survive a
/// round-trip untouched (forward compatibility, SPEC §4.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParticleEvent {
    pub v: u8,
    /// "evt_" + ULID.
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// "prj_" + ULID of the project this event belongs to.
    pub project: String,
    /// `github:<login>` or `agent:<role>/<run-id>`.
    pub actor: String,
    pub clock: Clock,
    /// Ids of events this one causally depends on.
    pub parents: Vec<String>,
    pub data: Value,
}
