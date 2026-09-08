# Recall — Design System

**Status:** Source of truth · **Version:** 1.0 · **Date:** 2026-09-08

## Direction

**RESTRAINED BRUTALIST PRODUCTIVITY UI** — crisp, editorial, utilitarian, high-information, polished, distinctive, fast, serious. Not decorative brutalism; not generic AI SaaS.

### Do

- Strong 1–2px borders, compact radii
- Clear hierarchy, strong typography
- Restrained offset shadows
- Generous but intentional whitespace, precise alignment
- Obvious interactive states (hover/focus/active/disabled)

### Avoid

- Gradients, glassmorphism, glowing blobs
- Excessive floating cards, 24px-rounded everything
- Enormous marketing headlines, excessive pills
- Random colors/shadows

## Semantic Tokens (light + dark required)

```
background, foreground, surface, surface-raised,
muted, muted-foreground, border, border-strong,
primary, primary-foreground, accent, accent-foreground,
success, warning, destructive, focus, selection
```

- Tailwind CSS-var tokens (`tailwind.config.js`) are the mechanism; extend, never bypass with hardcoded screen colors where a token exists.
- Existing token set (background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring) is extended toward the list above during Phase 2.
- WCAG contrast validated in both modes.

## Typography

- One primary sans family (currently `Source_Sans_3` via next/font) + one optional mono for code/metadata. No additional decorative families.
- Explicit hierarchy: `display` → `page title` → `section title` → `body` → `small` → `caption` → `label` → `code/metadata`.
- Prefer typographic hierarchy over unnecessary boxes.

## Components

- shadcn/Radix primitives as the base (`components/ui/`), customized through Recall tokens/variants — not wrapped in unnecessary abstraction layers.
- Reuse: Button, Dialog, Dropdown, Select, Tabs, Tooltip, Popover, Switch, Separator, ScrollArea, Command, etc.
- Do not rerun shadcn init blindly; evolve existing configuration (`components.json`, style "new-york").

## Icons

- **Base stroke icons:** lucide-react (already in 71 files) — keep; no pointless repo-wide rewrite.
- **Morphicons:** for state-transition icons only (Play↔Pause, Mic↔Stop, Menu↔Close, Expand↔Collapse, theme/search/panel state). Motion must communicate state; don't animate everything.
- **TheSVG:** static brand/provider marks only, with licensing/source provenance recorded.
- Central icon registry; standard sizes 16/18/20/24; decorative icons `aria-hidden`; icon-only controls get accessible name + tooltip.
- No hand-drawn inline SVGs when a designated source has the icon.

## Motion

- Principles from Emil Kowalski's design-engineering skills: purposeful, fast, interruptible, transform/opacity preferred, reduced-motion supported, never motion for its own sake.
- Small set of Recall motion tokens (duration/easing) instead of scattered ad-hoc values.
- Existing framer-motion usage stays until tokenized in Phase 2.

## UI quality gate

Before accepting any redesigned screen, inspect in LIGHT and DARK modes and multiple desktop window widths: hierarchy, alignment, spacing, overflow, wrapping, empty/loading/error states, hover/focus/active/disabled, keyboard, tooltips, contrast, motion, reduced motion. If it does not look like one deliberate product designed by one team, keep refining.
