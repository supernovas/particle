/// A fresh 26-char Crockford-base32 ULID (uppercase, lexically time-sortable).
pub fn ulid() -> String {
    ulid::Ulid::new().to_string()
}

/// TypeID-style particle id: `<prefix>_<ULID>` (SPEC §2). Prefixes in use:
/// `prj`, `evt`, `tsk`, `run`.
pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", ulid())
}
