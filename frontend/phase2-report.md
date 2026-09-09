# Phase 2 Report — Design System + Icon/Motion System

## Summary

Phase 2 establishes Recall's visual and interaction foundation: a restrained brutalist productivity UI with semantic color tokens, theme switching, motion tokens, icon integration, and typography hierarchy. Every decision prioritizes clarity, restraint, and high information density over generic SaaS polish.

**Branch**: `phase/2-design-system` — 6 commits ahead of `main`
**Base**: `c3be39b` (Phase 1 closure)

## What Was Built

### 1. Semantic Color Tokens

**File**: `frontend/src/app/globals.css`

- 20+ semantic tokens per theme (light + dark)
- Core palette: `surface`, `surface-raised`, `border-strong`, `success`, `warning`, `focus`, `selection`
- Shadcn compatibility mapped: `card→surface`, `popover→surface-raised`, `secondary→muted`, `ring→focus`
- All values use CSS custom properties — single source of truth for both themes

**WCAG AA contrast validated** for all core text pairs (foreground/background, primary-foreground/primary, muted-foreground/background, accent-foreground/accent, destructive-foreground/destructive, success-foreground/success).

### 2. Theme System

**Files**: `src/contexts/ThemeContext.tsx`, `src/components/ThemeToggle.tsx`, `src/components/PreferenceSettings.tsx`

- **System/Light/Dark** preference with localStorage persistence (`recall-theme` key)
- OS media query listener for system preference
- `suppressHydrationWarning` on `<html>` to prevent SSR mismatch
- `ThemeToggle` component cycles System→Light→Dark with accessible label
- Settings page has dedicated Appearance section with theme buttons

### 3. Button Variant Migration

**File**: `src/components/ui/button.tsx`

| Before | After | Reason |
|--------|-------|--------|
| `blue` | `default` | Semantic naming, theme-aware |
| `red` | `destructive` | Semantic naming, theme-aware |
| `gray` | `outline` | Semantic naming, theme-aware |
| `green` | `success` | New variant, theme-aware |

- Added `active:scale-[0.97]` press feedback
- Added `focus-visible:ring-2 focus-visible:ring-offset-2` keyboard accessibility
- **17 call sites migrated** across 12 files

### 4. Badge Rewrite

**File**: `src/components/ui/badge.tsx`

- Was: hardcoded `bg-gray-100 text-gray-800` for all variants
- Now: CSS variable tokens with `variant="success"` and `variant="warning"` support
- All variants theme-responsive via `border-border` token

### 5. Skeleton Fix

**File**: `src/components/ui/skeleton.tsx`

- Was: `bg-gray-100/70 dark:bg-gray-800/50`
- Now: `bg-muted animate-pulse` — theme-aware, no hardcoded colors

### 6. Scrollbar Tokens

**File**: `frontend/src/app/globals.css`

- Was: hardcoded `#d1d5db` (light) / `#4b5563` (dark) with `#9ca3af` hover
- Now: `hsl(var(--muted-foreground))` for thumb, `hsl(var(--border))` for track
- Hover state uses `--muted-foreground` with reduced opacity

### 7. Typography Hierarchy

**File**: `frontend/src/app/globals.css`

7-level hierarchy with `letter-spacing` tuned for each:
- `text-display` (32px/600/-0.02em) — hero moments only
- `text-page-title` (24px/600/-0.015em) — page headers
- `text-section-title` (18px/600/-0.01em) — section breaks
- `text-body` (14px/400/0) — primary content
- `text-small` (13px/400/0.005em) — secondary text
- `text-caption` (12px/500/0.02em) — labels, metadata
- `text-code` (13px/500/0) — inline code

### 8. Motion System

**File**: `frontend/src/lib/motion.ts`

- Duration tokens: `instant` (120ms), `fast` (150ms), `standard` (250ms), `slow` (400ms)
- Easing tokens: `out`, `inOut`, `spring` (stiffness: 300, damping: 30)
- Pre-built Framer Motion transitions: `motionTokens.fast`, `motionTokens.spring`, etc.
- Page transition variants for consistent route animations

**CSS motion tokens** in `globals.css`:
- `--duration-instant`, `--duration-fast`, `--duration-standard`, `--duration-slow`
- `--ease-out`, `--ease-in-out`
- Uses Framer Motion defaults (cubic-bezier) not Emil's easing curves — existing codebase already uses Framer

### 9. Reduced Motion

**File**: `frontend/src/app/globals.css`

- **Intentional**, not blanket `* { animation: none }` (Emil's guidance)
- Targets specific animations: pulse, shimmer, toast slide-in
- Preserves `focus-visible` outlines (accessibility)
- Body text remains readable during animation pause

### 10. Icon System

**Files**: `src/lib/icons.ts`, `src/components/ui/morph-icon.tsx`

- **Icon registry**: `src/lib/icons.ts` — central re-exports of commonly used Lucide icons
- Standard sizes: 16/18/20/24 via `iconSize` constant
- Type-safe: `LucideIcon` type exported
- **Morphicons**: `morphicons@1.7.1` installed, uses `lucide` data package (`lucide@1.43.0`) for icon node extraction
- `RecallMorphIcon` wrapper: spring physics, reduced-motion fallback, `aria-hidden`, `focusable="false"`

### 11. Component Fixes

**Shared components** previously hardcoded to gray:
- `PageHeader`: `text-page-title text-foreground`, `text-small text-muted-foreground`
- `DownloadProgressToast`: All `gray-*` replaced with semantic tokens
- `SummaryTemplateManager`: Partial token migration (remaining gray deferred to screen redesign)

**BlockNote integration**:
- `Editor.tsx`: Uses `useTheme().resolvedTheme` instead of hardcoded `theme="light"`
- `BlockNoteSummaryView.tsx`: Same — follows app theme

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `src/app/globals.css` | **REWRITTEN** | Semantic tokens, motion tokens, typography, scrollbar, reduced-motion |
| `tailwind.config.js` | UPDATED | New tokens, monospace stack, compact radius, removed hardcoded tertiary |
| `src/contexts/ThemeContext.tsx` | NEW | ThemeProvider with System/Light/Dark + persistence |
| `src/components/ThemeToggle.tsx` | NEW | Icon button cycling System→Light→Dark |
| `src/components/PreferenceSettings.tsx` | REWRITTEN | Appearance section with theme selector |
| `src/components/ui/button.tsx` | REWRITTEN | Semantic variants, focus ring, active state |
| `src/components/ui/badge.tsx` | REWRITTEN | CSS variable tokens, success/warning variants |
| `src/components/ui/skeleton.tsx` | FIXED | `bg-muted` |
| `src/components/ui/morph-icon.tsx` | NEW | RecallMorphIcon wrapper |
| `src/lib/icons.ts` | NEW | Icon registry with Lucide re-exports |
| `src/lib/motion.ts` | NEW | Motion tokens, transitions, pageVariants |
| `src/app/layout.tsx` | UPDATED | ThemeProvider wrapping, suppressHydrationWarning |
| `src/components/BlockNoteEditor/Editor.tsx` | UPDATED | Uses resolvedTheme |
| `src/components/AISummary/BlockNoteSummaryView.tsx` | UPDATED | Uses resolvedTheme |
| `src/components/shared/PageHeader.tsx` | REWRITTEN | Semantic tokens |
| `src/components/shared/DownloadProgressToast.tsx` | UPDATED | Semantic tokens |
| `src/components/templates/SummaryTemplateManager.tsx` | PARTIALLY UPDATED | Section headers/lists use tokens |
| `tests/lib/design-system-regression.test.mjs` | NEW | 15 regression tests |
| `Memory.md` | UPDATED | Phase 2 state |
| `package.json` | UPDATED | morphicons, lucide data package |
| `pnpm-workspace.yaml` | NEW | lucide version exclusion |
| 12 files with button variant migrations | UPDATED | blue→default, red→destructive |

## Validation Gates

| Gate | Result |
|------|--------|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets` | PASS (warnings only) |
| `cargo test --workspace` | 343 passed, 2 ignored, 0 failed |
| `pnpm run build` | PASS (12 routes, 0 errors) |
| `node --test tests/lib/*.test.mjs` | 145 pass / 1 fail (pre-existing qa-routes bun mismatch) |
| `node tests/contract/audit.mjs` | 80 passed, 0 violations, 1 note |
| `node --test tests/lib/updater-regression.test.mjs` | 6/6 PASS |
| `node --test tests/lib/analytics-regression.test.mjs` | 5/5 PASS |
| `node --test tests/lib/design-system-regression.test.mjs` | 15/15 PASS |

## Design Decisions

1. **Tokens over hardcoded values**: Every color goes through CSS custom properties. No more `gray-*` in component code.
2. **Intentional reduced-motion**: Not blanket `animation: none`. Targets specific animations while preserving focus-visible.
3. **Framer Motion easing**: Used project defaults (cubic-bezier) rather than Emil's custom curves. Existing codebase already uses Framer.
4. **Morphicons use Lucide data**: Not raw SVG. Consistent icon language, spring physics, reduced-motion fallback.
5. **Theme persistence**: localStorage with `recall-theme` key. OS detection via `prefers-color-scheme` media query.
6. **No Tailwind v4 upgrade**: Stayed on Tailwind 3 per risk-aversion rule.
7. **No additional fonts**: Source Sans 3 remains primary. No decorative fonts added.
8. **Deferred**: TemplateEditor.tsx has 15+ hardcoded gray references (redesign phase). SummaryTemplateManager partially migrated.

## Remaining Design Debt

- `TemplateEditor.tsx`: 15+ hardcoded `gray-*` references (deferred to screen redesign)
- `SummaryTemplateManager.tsx`: Template list items still use hardcoded gray (deferred)
- Tailwind CSS lint baseline: 128 errors / 153 warnings (pre-existing, deferred to quality phase)

## Skills Used

- **ibelick/ui-skills**: baseline-ui (contrast verification, reduced-motion), fixing-accessibility (keyboard nav, focus-visible), fixing-motion-performance (animation auditing)
- **emilkowalski/skills**: emil-design-eng (animation philosophy, spring physics, duration/easing guidance, component principles)

## Next Phase

Phase 3 should build on this foundation with the first user-facing screen (e.g., Settings redesign or Meeting Details), applying the tokens, motion system, and icon registry in context.
