//! Particle protocol kernel (SPEC v0): the event envelope, prefixed ids,
//! lamport clocks, the canonical total order, and the deterministic fold.
//! This is the Rust counterpart of `@particle/core`; both must converge on
//! byte-identical materializations (see docs/SPEC.md §1 and the P1.T8
//! conformance corpus).

mod canonical;
mod clock;
mod event;
mod fold;
mod id;

pub use canonical::canonical_json;
pub use clock::{compare_events, next_clock};
pub use event::{Clock, ParticleEvent};
pub use fold::{
    fold, is_converged, MessageState, ProjectState, ReviewState, TaskState, TaskStatus,
};
pub use id::{new_id, ulid};
