use serde_json::Value;

/// Canonical JSON (SPEC §6): object keys sorted, no insignificant whitespace,
/// LF, trailing newline. `serde_json::Value` objects are `BTreeMap`s (the
/// `preserve_order` feature is deliberately not enabled), so serialization is
/// key-sorted by construction. Events use only strings and integers, keeping
/// number formatting trivially portable across implementations.
pub fn canonical_json(value: &Value) -> String {
    let mut out = serde_json::to_string(value).expect("Value serialization cannot fail");
    out.push('\n');
    out
}
