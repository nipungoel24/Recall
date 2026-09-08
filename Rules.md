# Recall — Engineering Rules

**Status:** Binding on all subsequent work · **Version:** 1.0 · **Date:** 2026-09-08

## Git

- No destructive history operations: no `reset --hard`, no `clean -fdx`, no `checkout -- .` over unknown work, no force push (`--force`, `--force-with-lease`) unless the user explicitly orders it.
- Never delete unknown uncommitted or local work. Before any reconciliation: record HEAD, create a safety ref/branch, preserve diffs and untracked files, then proceed.
- Small coherent commits; one concern per commit where practical.
- Local backup branches are never automatically pushed.
- Upstream (`Zackriya-Solutions/meetily`) is REFERENCE ONLY. Never push to it, never merge it wholesale. Its git history is unrelated to Recall's — comparisons are tree-based.

## Investigation

- Read callers, callees, types, persistence implications, and existing tests before changing important logic.
- Never modify a function based solely on its name.
- Baseline failures that pre-exist are documented, not silently "fixed" mid-task.

## Rust safety

- Production Rust must not use `unwrap()`, `expect()`, `panic!()`, `todo!()`, `unimplemented!()` for normal recoverable behavior. Return `Result` with useful context.
- Do not hold locks longer than necessary; avoid blocking async execution.
- Keep Tauri commands thin; business logic lives in services/modules.
- Test-only code may use asserts; `clippy::absurd_extreme_comparisons` must stay clean.

## TypeScript

- Avoid `any`. Where unavoidable, isolate and explain it. Prefer explicit domain types and unions over stringly-typed state.
- Validate external/AI data (Zod or manual guards); never trust raw LLM output.
- Error/loading/empty/success states for every async user flow, plus retry/cancel where appropriate.

## Persistence

- Never destructively migrate user data. All schema changes require a new migration; shipped migrations are never rewritten (checksummed).
- Test upgrades from existing installations (Meetily-era installs must keep working).
- AI artifacts that are derived (summaries, memory, daily briefs) never mutate source meetings/transcripts.

## Privacy

- No new telemetry by default. Never send recording/transcript/notes/meeting title/file paths/prompt content to telemetry.
- Any cloud AI provider must be explicitly selected by the user; never silently fall back from local to cloud.
- Secrets and API keys are never logged or committed.

## Dependencies

Before adding a dependency: (1) check existing dependencies solve it, (2) maintenance status, (3) bundle impact, (4) licensing, (5) justify. No major framework upgrades bundled into unrelated feature work.

## UI

- Use shadcn/Radix primitives; reuse existing components before creating duplicates.
- Semantic design tokens only; no one-off arbitrary design values where a token exists; no new design language per screen.
- Icons: central registry; lucide-react remains the base stroke set; Morphicons for state-transition icons; TheSVG only for brand/provider marks with provenance; decorative icons `aria-hidden`; icon-only controls need accessible names + tooltips.

## Accessibility

- Keyboard accessible, visible focus, meaningful labels, tooltips for icon-only controls, minimum reasonable pointer targets, reduced-motion support, WCAG contrast, semantic HTML.

## Performance

- Avoid unnecessary re-renders; virtualize genuinely large lists; prefer transform/opacity for motion; measure before optimizing native code.

## AI agent behavior (this repo)

- Never create random files — Architecture.md decides locations.
- Never change unrelated behavior for cleanup's sake; cleanup is separately reviewed.
- Never mark work done without verification; never alter tests to make broken behavior pass.
- Update Memory.md (after Phase 1 begins) after every completed task, major decision, and before ending a session.

## Documentation

- PRD.md, Architecture.md, Rules.md, Phases.md, Design.md are source of truth. Update them when architecture or product behavior changes.
- README claims must match implementation; new claims require verification.
