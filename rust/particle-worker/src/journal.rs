use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result};
use particle_core::ParticleEvent;

/// Phase-0 stand-in for the git ref store (P1.T3): an append-only NDJSON event
/// journal on disk, format-compatible with the TypeScript worker's journal.
pub struct Journal {
    path: PathBuf,
}

impl Journal {
    pub fn new(path: PathBuf) -> Result<Self> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        Ok(Journal { path })
    }

    pub fn load(&self) -> Result<Vec<ParticleEvent>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let raw = fs::read_to_string(&self.path)?;
        raw.lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str(line).with_context(|| format!("bad journal line: {line}"))
            })
            .collect()
    }

    pub fn append(&self, events: &[ParticleEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        for event in events {
            serde_json::to_writer(&mut file, event)?;
            file.write_all(b"\n")?;
        }
        Ok(())
    }
}
