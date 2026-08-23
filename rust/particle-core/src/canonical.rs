use serde_json::Value;

/// Canonical JSON (SPEC §6): object keys sorted, no insignificant whitespace,
/// LF, trailing newline, and ECMAScript number spelling to match the TypeScript
/// kernel's `JSON.stringify` contract byte-for-byte.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    encode(value, &mut out);
    out.push('\n');
    out
}

fn encode(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => {
            // JavaScript has one numeric type. Converting every JSON number to
            // f64 also reproduces its rounding outside Number.MAX_SAFE_INTEGER.
            let value = value.as_f64().expect("serde_json number must fit f64");
            out.push_str(ryu_js::Buffer::new().format_finite(value));
        }
        Value::String(value) => {
            out.push_str(&serde_json::to_string(value).expect("string serialization cannot fail"));
        }
        Value::Array(values) => {
            out.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                encode(value, out);
            }
            out.push(']');
        }
        Value::Object(values) => {
            out.push('{');
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(
                    &serde_json::to_string(key).expect("object-key serialization cannot fail"),
                );
                out.push(':');
                encode(value, out);
            }
            out.push('}');
        }
    }
}
