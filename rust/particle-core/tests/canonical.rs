use particle_core::canonical_json;
use serde_json::Value;

#[test]
fn canonical_numbers_match_ecmascript_spelling() {
    let value: Value =
        serde_json::from_str("[1.0,-0.0,100000000000000000000,1e-7,1e21,9007199254740993]")
            .unwrap();

    assert_eq!(
        canonical_json(&value),
        "[1,0,100000000000000000000,1e-7,1e+21,9007199254740992]\n"
    );
}
