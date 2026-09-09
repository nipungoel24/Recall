# Phase 3 Report — Application Shell + Home

**Date:** 2026-09-09
**Branch:** `phase/3-shell-home`
**Base:** `a8a386b` (Phase 2 final main)

## Summary

Refreshed the sidebar and HomeDashboard to use Phase 2 design tokens throughout, replacing all remaining hardcoded Tailwind colors (`gray`, `white`, `blue`, `red`) with semantic tokens (`foreground`, `muted-foreground`, `surface`, `accent`, `primary`, `destructive`, `border`).

## Changes

### Sidebar (`components/Sidebar/index.tsx`)

| Before | After |
|---|---|
| `bg-red-500` | `bg-destructive` |
| `hover:bg-red-600` | `hover:bg-destructive/90` |
| `text-white` | `text-primary-foreground` |
| `bg-accent` (active state) | unchanged — already correct |

Commented-out legacy code (`bg-blue-50`, `border-white`, `text-gray-700`) left as-is — dead code, not surfaced to users.

### HomeDashboard (`components/Home/HomeDashboard.tsx`)

| Before | After |
|---|---|
| `bg-gray-50` (page) | `bg-background` |
| `bg-white` (cards) | `bg-surface` |
| `border-gray-200` | `border-border` |
| `text-gray-900` (headings) | `text-foreground` |
| `text-gray-500` (descriptions) | `text-muted-foreground` |
| `text-blue-600` / `text-blue-500` (links) | `text-primary` |
| `hover:bg-gray-50` | `hover:bg-accent/50` |
| `divide-gray-100` | `divide-border` |
| `bg-blue-50` (context icons) | `bg-primary/10` |
| `group-hover:text-blue-700` | `group-hover:text-primary` |
| `group-hover:text-blue-500` | `group-hover:text-primary` |
| `bg-gray-50` (error state) | `bg-muted` |
| `text-gray-600` (onboarding) | `text-muted-foreground` |

### Phase 3 Test Suite (`tests/lib/phase3-shell-home.test.mjs`)

17 tests across 5 suites:
- **Shell tokens (3)**: sidebar hardcoded color audit, bg-accent active state, MainContent bg-background
- **Home tokens (7)**: hardcoded color audit, bg-background page, bg-surface cards, text-foreground headings, text-muted-foreground descriptions, divide-border lists, border-border cards
- **Routes (2)**: exports completeness, path format validation
- **Design-system compliance (2)**: CSS variable existence, Tailwind config mapping
- **Test/tooling (3)**: design-system-regression, branding-regression, contract audit existence

## Validation Gates

| Gate | Result |
|---|---|
| `pnpm run build` | Compiled successfully |
| `cargo fmt --all --check` | Clean |
| `cargo test --workspace` | 343 passed, 0 failed |
| Contract audit | 80 passed, 0 violations |
| Phase 3 regression tests | 17/17 pass |
| Design-system regression | 20/20 pass |
| Updater regression | pass |
| Analytics regression | pass |

## Commits

```
2a03af9 refactor(sidebar): apply Phase 2 design tokens to sidebar shell
e97092f refactor(home): apply Phase 2 design tokens to HomeDashboard
0908dd2 fix(sidebar): complete semantic token migration + add Phase 3 tests
```

## Notes

- 1 pre-existing JS test failure (bun npm-wrapper ESM issue on Windows) — unrelated to our changes
- TemplateEditor.tsx and SummaryTemplateManager.tsx remaining hardcoded gray deferred to their screen redesign phases per Phases.md
