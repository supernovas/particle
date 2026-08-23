use std::cmp::Ordering;

use crate::event::{Clock, ParticleEvent};

/// Next clock for an appender that has `observed` events and last wrote `prev`.
pub fn next_clock(prev: Option<&Clock>, observed: &[Clock], wall: String) -> Clock {
    let mut lamport = prev.map(|c| c.lamport).unwrap_or(0);
    for c in observed {
        lamport = lamport.max(c.lamport);
    }
    Clock {
        lamport: lamport + 1,
        wall,
    }
}

/// Total order over events: lamport, then actor, then id — byte order on the
/// strings (SPEC §4.2). Deterministic for any two distinct events, so every
/// replica sorts an event set identically.
pub fn compare_events(a: &ParticleEvent, b: &ParticleEvent) -> Ordering {
    a.clock
        .lamport
        .cmp(&b.clock.lamport)
        .then_with(|| a.actor.as_bytes().cmp(b.actor.as_bytes()))
        .then_with(|| a.id.as_bytes().cmp(b.id.as_bytes()))
}
