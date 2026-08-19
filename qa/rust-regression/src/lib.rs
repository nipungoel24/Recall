//! QA regression harness (not part of the app).
//!
//! The main `meetily` crate cannot compile on this machine today: the pinned
//! whisper-rs-sys 0.11.1 fails in BOTH binding paths (fresh bindgen produces an
//! opaque `whisper_full_params`; the bundled bindings.rs has stale layout sizes).
//! That is an upstream/toolchain issue independent of the intelligence features.
//!
//! This harness compiles the feature agents' PURE LOGIC modules directly from
//! their live file paths (`#[path]` includes, no copies) so their unit tests
//! and QA's adversarial tests run without the audio stack:
//!
//! - `context/{dedup,model,prompts,render,memory,repository}.rs` (continuous memory)
//! - `summary/templates/{types,store}.rs` + QA's minimal real loader stub
//! - `database/repositories/meeting_range.rs` (calendar range queries, contract 3)
//!
//! Run from the harness directory:
//!   cargo test
//!
//! NOTE: `sqlx::migrate!` macros inside the included files resolve relative to
//! this crate's CARGO_MANIFEST_DIR, so this crate ships a QA-owned mirror of the
//! app migration schema (see migrations/). Keep it in sync when the app schema
//! changes: a divergence will show up as failing tests here, which is exactly
//! the canary signal we want.

// `crate::context::*` — mirrors frontend/src-tauri/src/context/mod.rs (subset).
pub mod context {
    #[path = "../../../../frontend/src-tauri/src/context/model.rs"]
    pub mod model;
    #[path = "../../../../frontend/src-tauri/src/context/dedup.rs"]
    pub mod dedup;
    #[path = "../../../../frontend/src-tauri/src/context/prompts.rs"]
    pub mod prompts;
    #[path = "../../../../frontend/src-tauri/src/context/render.rs"]
    pub mod render;
    #[path = "../../../../frontend/src-tauri/src/context/repository.rs"]
    pub mod repository;
    #[path = "../../../../frontend/src-tauri/src/context/memory.rs"]
    pub mod memory;
}

// Mirrors frontend/src-tauri/src/summary/templates/{types,store}.rs with a QA
// loader stub standing in for the real loader.rs (which is owner-owned and
// pulls defaults/once_cell/fs machinery irrelevant to the storage rules).
pub mod summary_templates {
    #[path = "../../../../frontend/src-tauri/src/summary/templates/types.rs"]
    pub mod types;
    #[path = "../loader_stub.rs"]
    pub mod loader;
    #[path = "../../../../frontend/src-tauri/src/summary/templates/store.rs"]
    pub mod store;

    // Mirrors the re-exports in the real summary/templates/mod.rs that
    // store.rs relies on via `super::`.
    pub use loader::validate_and_parse_template;
}

// Mirrors frontend/src-tauri/src/database/repositories/meeting_range.rs.
pub mod database {
    pub mod repositories {
        #[path = "../../../../../frontend/src-tauri/src/database/repositories/meeting_range.rs"]
        pub mod meeting_range;
    }
}
