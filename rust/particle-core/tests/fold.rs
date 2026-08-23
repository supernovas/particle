use particle_core::{
    compare_events, fold, is_converged, new_id, next_clock, Clock, ParticleEvent, TaskStatus,
};
use serde_json::{json, Value};

fn event(project: &str, kind: &str, actor: &str, lamport: u64, data: Value) -> ParticleEvent {
    ParticleEvent {
        v: 0,
        id: new_id("evt"),
        kind: kind.to_string(),
        project: project.to_string(),
        actor: actor.to_string(),
        clock: Clock {
            lamport,
            wall: format!("2026-01-01T00:00:{lamport:02}.000Z"),
        },
        parents: vec![],
        data,
    }
}

fn sample_events(project: &str) -> Vec<ParticleEvent> {
    vec![
        event(
            project,
            "project.created",
            "github:alice",
            1,
            json!({"title": "Ship the widget", "source": {"kind": "github-issue", "repo": "acme/widget", "number": 7}}),
        ),
        event(
            project,
            "message.posted",
            "github:alice",
            2,
            json!({"body": "please build the widget"}),
        ),
        event(
            project,
            "task.created",
            "agent:planner/p1",
            3,
            json!({"taskId": "t1", "title": "scaffold", "spec": "set up the repo", "deps": []}),
        ),
        event(
            project,
            "task.created",
            "agent:planner/p1",
            4,
            json!({"taskId": "t2", "title": "implement", "spec": "build the thing", "deps": ["t1"]}),
        ),
        event(
            project,
            "task.claimed",
            "agent:impl/i1",
            5,
            json!({"taskId": "t1"}),
        ),
        event(
            project,
            "task.updated",
            "agent:impl/i1",
            6,
            json!({"taskId": "t1", "status": "done"}),
        ),
        event(
            project,
            "task.claimed",
            "agent:impl/i2",
            7,
            json!({"taskId": "t2"}),
        ),
        event(
            project,
            "task.updated",
            "agent:impl/i2",
            8,
            json!({"taskId": "t2", "status": "done"}),
        ),
        event(
            project,
            "review.posted",
            "agent:reviewer/r1",
            9,
            json!({"verdict": "approve", "comments": []}),
        ),
    ]
}

fn shuffle<T: Clone>(items: &[T], seed: u64) -> Vec<T> {
    let mut out: Vec<T> = items.to_vec();
    let mut s = seed;
    for i in (1..out.len()).rev() {
        s = (s.wrapping_mul(1_103_515_245).wrapping_add(12_345)) % 2_147_483_648;
        let j = (s as usize) % (i + 1);
        out.swap(i, j);
    }
    out
}

#[test]
fn builds_project_state_from_an_event_log() {
    let project = new_id("prj");
    let state = fold(&project, &sample_events(&project));
    assert_eq!(state.title, "Ship the widget");
    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.tasks.len(), 2);
    assert_eq!(state.tasks["t1"].status, TaskStatus::Done);
    assert_eq!(state.tasks["t1"].assignee.as_deref(), Some("agent:impl/i1"));
    assert_eq!(state.last_review.as_ref().unwrap().verdict, "approve");
    assert!(is_converged(&state));
}

#[test]
fn is_invariant_under_delivery_order() {
    let project = new_id("prj");
    let events = sample_events(&project);
    let reference = fold(&project, &events);
    for seed in 1..=25u64 {
        assert_eq!(
            fold(&project, &shuffle(&events, seed)),
            reference,
            "seed {seed}"
        );
    }
}

#[test]
fn ignores_duplicate_deliveries() {
    let project = new_id("prj");
    let events = sample_events(&project);
    let once = fold(&project, &events);
    let mut twice = events.clone();
    twice.extend(events.clone());
    assert_eq!(fold(&project, &twice), once);
}

#[test]
fn resolves_concurrent_claims_deterministically() {
    let project = new_id("prj");
    let base = vec![
        event(
            &project,
            "project.created",
            "github:alice",
            1,
            json!({"title": "race", "source": {"kind": "chat", "channel": "#eng"}}),
        ),
        event(
            &project,
            "task.created",
            "agent:planner/p1",
            2,
            json!({"taskId": "t1", "title": "contested", "spec": "", "deps": []}),
        ),
    ];
    // Two actors claim concurrently with the same lamport clock.
    let claim_a = event(
        &project,
        "task.claimed",
        "agent:impl/a",
        3,
        json!({"taskId": "t1"}),
    );
    let claim_b = event(
        &project,
        "task.claimed",
        "agent:impl/b",
        3,
        json!({"taskId": "t1"}),
    );

    let mut order1 = base.clone();
    order1.push(claim_a.clone());
    order1.push(claim_b.clone());
    let mut order2 = base;
    order2.push(claim_b);
    order2.push(claim_a);

    let s1 = fold(&project, &order1);
    let s2 = fold(&project, &order2);
    assert_eq!(s1.tasks["t1"].assignee, s2.tasks["t1"].assignee);
    assert_eq!(s1.tasks["t1"].assignee.as_deref(), Some("agent:impl/a"));
}

#[test]
fn ignores_events_from_other_projects() {
    let project = new_id("prj");
    let foreign_project = new_id("prj");
    let foreign = sample_events(&foreign_project);
    let state = fold(&project, &foreign[..1]);
    assert_eq!(state.title, "");
    assert!(state.seen.is_empty());
}

#[test]
fn preserves_unknown_event_types_through_serde() {
    let raw = r#"{"v":0,"id":"evt_01AAAAAAAAAAAAAAAAAAAAAAAA","type":"totally.unknown","project":"prj_01AAAAAAAAAAAAAAAAAAAAAAAA","actor":"github:x","clock":{"lamport":1,"wall":"2026-01-01T00:00:00.000Z"},"parents":[],"data":{"z":1,"a":2}}"#;
    let parsed: ParticleEvent = serde_json::from_str(raw).unwrap();
    assert_eq!(parsed.kind, "totally.unknown");
    let back = serde_json::to_value(&parsed).unwrap();
    assert_eq!(back["data"], json!({"a": 2, "z": 1}));
    // Folding an unknown type is a no-op beyond bookkeeping.
    let state = fold(&parsed.project.clone(), std::slice::from_ref(&parsed));
    assert_eq!(state.clock, 1);
    assert!(state.seen.contains(&parsed.id));
}

#[test]
fn clock_advances_past_everything_observed() {
    let observed = vec![
        Clock {
            lamport: 4,
            wall: "2026-01-01T00:00:00.000Z".into(),
        },
        Clock {
            lamport: 9,
            wall: "2026-01-01T00:00:01.000Z".into(),
        },
    ];
    let prev = Clock {
        lamport: 2,
        wall: "2026-01-01T00:00:02.000Z".into(),
    };
    let next = next_clock(Some(&prev), &observed, "2026-01-01T00:00:03.000Z".into());
    assert_eq!(next.lamport, 10);
}

#[test]
fn ids_carry_their_prefix_and_sort() {
    let a = new_id("evt");
    assert_eq!(a.len(), 30);
    assert!(a.starts_with("evt_"));
    assert!(a[4..]
        .bytes()
        .all(|b| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&b)));
}

#[test]
fn compare_is_a_total_order_on_distinct_events() {
    let project = new_id("prj");
    let events = sample_events(&project);
    for (i, a) in events.iter().enumerate() {
        for (j, b) in events.iter().enumerate() {
            if i != j {
                assert_ne!(compare_events(a, b), std::cmp::Ordering::Equal);
            }
        }
    }
}
