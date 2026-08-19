//! Continuous Meeting Context — durable compact memory across meetings.
//!
//! # Goal
//!
//! Meeting N benefits from durable knowledge extracted from meetings 1..N-1
//! without sending the complete historical transcripts to the model every time.
//!
//! # Design
//!
//! - Memory is scoped to a context thread (contract §6): the relational
//!   `context_memory_items` working set (kinds `fact | decision | action |
//!   question | note`, per-item provenance, timestamps, status) plus the
//!   durable-core `contexts.memory_markdown` digest.
//! - After a meeting summary is generated, a background pass extracts memory
//!   items from the summary and merges them (contract §8 update side).
//!   Extraction reuses the exact LLM provider/model/endpoint configured for
//!   summary generation. No new cloud infrastructure, no hidden requests.
//! - For the next meeting, a compact markdown block bounded by an explicit
//!   token budget is prepended to the user custom prompt as supplementary
//!   background data (contract §8.1). Template instructions are never
//!   replaced.
//! - Memory never grows without bound: when the working set exceeds the
//!   budget, low-priority items are folded into `contexts.memory_markdown`
//!   (with provenance) and removed from the working set.
//!
//! # Failure model
//!
//! Extraction happens before any write; a provider failure leaves memory
//! untouched and never affects recording/transcription/summary save.
//! Memory updates run in the background and only log failures.
//!
//! # Deduplication (conservative, deterministic)
//!
//! Duplicate detection is purely deterministic (normalised text containment).
//! No claim of perfect semantic deduplication is made. Working-set items are
//! only closed when the model emits a resolution that matches an open item;
//! re-mentioning an item never closes it.
//!
//! # Prompt injection posture
//!
//! Previous meeting content is DATA, not instructions. Prompts clearly delimit
//! application instructions, context memory, and current transcript, and
//! neutralise occurrences of our own delimiter tags inside data blocks.

pub mod dedup;
pub mod engine;
pub mod extraction;
pub mod memory;
pub mod model;
pub mod prompts;
pub mod render;
pub mod repository;

pub use memory::{
    get_compact_context_memory, load_and_render_context_memory, render_context_memory,
};
