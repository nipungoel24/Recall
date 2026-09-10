/**
 * Phase 3 — Shell + Home Regression Test
 *
 * Verifies:
 * - Sidebar uses semantic tokens (no hardcoded gray/white/blue/red)
 * - HomeDashboard uses semantic tokens (no hardcoded gray/white/blue)
 * - Sidebar accessibility: aria-current, button semantics, focus-visible
 * - Keyboard shortcut (Ctrl+K) exists
 * - Home failure states: brief error, contexts error
 * - Home hierarchy: brutalist (no shadows, no excessive rounding)
 * - Routes file exports all required route helpers
 * - CSS variables and Tailwind config map semantic tokens
 * - Required test/tooling files exist
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(import.meta.dirname, '../../src')
const testsDir = join(import.meta.dirname, '../..')

function read(rel) {
  return readFileSync(join(srcDir, rel), 'utf8')
}

function readRoot(rel) {
  return readFileSync(join(testsDir, rel), 'utf8')
}

// ── Shell tokens ──────────────────────────────────────────

describe('Phase 3 — shell tokens', () => {
  it('sidebar uses no hardcoded gray/white/blue/red', () => {
    const raw = read('components/Sidebar/index.tsx')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    const violations = []
    if (/bg-gray-/.test(src)) violations.push('bg-gray')
    if (/text-gray-/.test(src)) violations.push('text-gray')
    if (/border-gray-/.test(src)) violations.push('border-gray')
    if (/bg-white/.test(src)) violations.push('bg-white')
    if (/text-white/.test(src)) violations.push('text-white')
    if (/bg-blue-/.test(src)) violations.push('bg-blue')
    if (/text-blue-/.test(src)) violations.push('text-blue')
    if (/bg-red-/.test(src)) violations.push('bg-red')
    if (/text-red-/.test(src)) violations.push('text-red')
    assert.deepEqual(violations, [], 'sidebar must use semantic tokens, not raw Tailwind colors')
  })

  it('sidebar uses bg-accent for active nav items', () => {
    const src = read('components/Sidebar/index.tsx')
    assert.ok(src.includes('bg-accent'), 'sidebar must use bg-accent for active state')
  })

  it('MainContent wrapper uses bg-background', () => {
    const src = read('components/MainContent/index.tsx')
    assert.ok(src.includes('bg-background'), 'MainContent wrapper must use bg-background')
  })
})

// ── Sidebar accessibility ─────────────────────────────────

describe('Phase 3 — sidebar accessibility', () => {
  it('expanded nav items are <button> elements, not <div>', () => {
    const src = read('components/Sidebar/index.tsx')
    // Find expanded nav section (after "Fixed navigation items" comment)
    const navStart = src.indexOf('Fixed navigation items')
    assert.ok(navStart > 0, 'nav section must exist')
    const navSection = src.slice(navStart, navStart + 3000)
    // Should NOT have div with onClick for route navigation
    const divWithOnClick = navSection.match(/<div[^>]*onClick[^>]*router\.push/g)
    assert.ok(
      !divWithOnClick || divWithOnClick.length === 0,
      'expanded nav items must be <button>, not <div> with onClick',
    )
  })

  it('sidebar has aria-current="page" on active nav items', () => {
    const src = read('components/Sidebar/index.tsx')
    assert.ok(
      src.includes("aria-current="),
      'sidebar must use aria-current on active nav items',
    )
    // Should have aria-current on at least 4 items (Home, Calendar, Daily, Contexts/Templates/Settings)
    const ariaCurrentCount = (src.match(/aria-current=/g) || []).length
    assert.ok(
      ariaCurrentCount >= 4,
      `sidebar should have aria-current on multiple nav items (found ${ariaCurrentCount})`,
    )
  })

  it('sidebar nav buttons have focus-visible styling', () => {
    const src = read('components/Sidebar/index.tsx')
    assert.ok(
      src.includes('focus-visible:ring'),
      'sidebar nav buttons must have focus-visible:ring styling',
    )
  })

  it('sidebar has Ctrl+K keyboard shortcut with deferred focus for collapsed state', () => {
    const src = read('components/Sidebar/index.tsx')
    // Must have the shortcut handler
    assert.ok(
      src.includes("metaKey") || src.includes("ctrlKey"),
      'sidebar must have Ctrl+K / Cmd+K handler',
    )
    assert.ok(
      src.includes("'k'") || src.includes('"k"'),
      'sidebar must check for k key in shortcut handler',
    )
    // Must use deferred focus pattern: pendingSearchFocus state for collapsed→expanded transition
    assert.ok(
      src.includes('pendingSearchFocus'),
      'sidebar must use pendingSearchFocus for deferred focus after expand',
    )
    // Must NOT focus input directly when collapsed (the bug)
    // The handler should set pendingSearchFocus + toggleCollapse when collapsed,
    // and only focus directly when already expanded
    const handlerBlock = src.slice(
      src.indexOf('metaKey') !== -1 ? src.indexOf('metaKey') : src.indexOf('ctrlKey'),
      src.indexOf('metaKey') !== -1 ? src.indexOf('metaKey') + 500 : src.indexOf('ctrlKey') + 500,
    )
    assert.ok(
      handlerBlock.includes('setPendingSearchFocus(true)'),
      'collapsed Ctrl+K must set pendingSearchFocus instead of focusing directly',
    )
    // Must have a post-expansion effect that focuses after isCollapsed becomes false
    assert.ok(
      src.includes('pendingSearchFocus && !isCollapsed'),
      'must have effect that focuses search after expansion completes',
    )
  })

  it('sidebar search input has aria-label', () => {
    const src = read('components/Sidebar/index.tsx')
    assert.ok(
      src.includes('aria-label="Search'),
      'sidebar search input must have aria-label',
    )
  })

  it('Import Audio button has aria-label', () => {
    const src = read('components/Sidebar/index.tsx')
    assert.ok(
      src.includes('aria-label="Import Audio"'),
      'Import Audio button must have aria-label',
    )
  })

  it('sidebar collapse/expand button has focus-visible ring', () => {
    const src = read('components/Sidebar/index.tsx')
    // Find the collapse toggle button (has toggleCollapse onClick + aria-label containing "sidebar")
    const collapseIdx = src.indexOf("isCollapsed ? 'Expand sidebar'")
    assert.ok(collapseIdx > 0, 'collapse button with aria-label must exist')
    const surroundingCode = src.slice(collapseIdx, collapseIdx + 400)
    assert.ok(
      surroundingCode.includes('focus-visible:ring'),
      'collapse/expand button must have focus-visible ring',
    )
  })
})

// ── Home tokens ───────────────────────────────────────────

describe('Phase 3 — home tokens', () => {
  it('HomeDashboard uses no hardcoded gray/white/blue', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    const violations = []
    if (/bg-gray-/.test(src)) violations.push('bg-gray')
    if (/text-gray-/.test(src)) violations.push('text-gray')
    if (/border-gray-/.test(src)) violations.push('border-gray')
    if (/bg-white/.test(src)) violations.push('bg-white')
    if (/text-white/.test(src)) violations.push('text-white')
    if (/bg-blue-/.test(src)) violations.push('bg-blue')
    if (/text-blue-/.test(src)) violations.push('text-blue')
    assert.deepEqual(violations, [], 'home must use semantic tokens, not raw Tailwind colors')
  })

  it('HomeDashboard uses bg-background for page wrapper', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(src.includes('bg-background'), 'HomeDashboard page wrapper must use bg-background')
  })

  it('HomeDashboard uses text-muted-foreground for descriptions', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    const mutedCount = (src.match(/text-muted-foreground/g) || []).length
    assert.ok(
      mutedCount >= 5,
      `HomeDashboard should use text-muted-foreground for descriptions (found ${mutedCount})`,
    )
  })

  it('HomeDashboard uses divide-border for list separators', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(src.includes('divide-border'), 'HomeDashboard must use divide-border for lists')
  })

  it('HomeDashboard uses border-border for sections', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(src.includes('border-border'), 'HomeDashboard sections must use border-border')
  })
})

// ── Home hierarchy (brutalist) ────────────────────────────

describe('Phase 3 — home hierarchy', () => {
  it('HomeDashboard has no shadow-sm (brutalist: no shadows)', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      !src.includes('shadow-sm'),
      'HomeDashboard must not use shadow-sm (brutalist direction)',
    )
  })

  it('HomeDashboard has no rounded-xl or rounded-2xl sections', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      !src.includes('rounded-xl'),
      'HomeDashboard must not use rounded-xl (brutalist: compact radii)',
    )
    assert.ok(
      !src.includes('rounded-2xl'),
      'HomeDashboard must not use rounded-2xl (brutalist: compact radii)',
    )
  })

  it('HomeDashboard section headers use uppercase tracking-wider', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      src.includes('uppercase'),
      'HomeDashboard section headers should use uppercase tracking',
    )
    assert.ok(
      src.includes('tracking-wider'),
      'HomeDashboard section headers should use tracking-wider',
    )
  })
})

// ── Home failure states ───────────────────────────────────

describe('Phase 3 — home failure states', () => {
  it('HomeDashboard imports AlertTriangle for error indicators', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      src.includes('AlertTriangle'),
      'HomeDashboard must import AlertTriangle for failure states',
    )
  })

  it('HomeDashboard distinguishes brief load error from generation failure', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    // Must have separate briefLoadError state for status-fetch failures
    assert.ok(
      src.includes('briefLoadError'),
      'HomeDashboard must have briefLoadError state for status-fetch failures',
    )
    // Must show "Couldn't load Daily Brief" for load errors (not "generation failed")
    assert.ok(
      src.includes("Couldn") && src.includes('load Daily Brief'),
      'HomeDashboard must show "Couldn\'t load Daily Brief" for status-fetch failures',
    )
    // Must show "Brief generation failed" for actual generation failures
    assert.ok(
      src.includes('Brief generation failed'),
      'HomeDashboard must show "Brief generation failed" for generation failures',
    )
    // Load error retry must call loadBriefStatus (not navigate)
    assert.ok(
      src.includes('loadBriefStatus'),
      'HomeDashboard must have loadBriefStatus callback for retry',
    )
    // Generation failure action must say "Open Daily to Retry" (not just "Retry")
    assert.ok(
      src.includes('Open Daily to Retry'),
      'generation failure action must say "Open Daily to Retry"',
    )
  })

  it('HomeDashboard shows contexts error state', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      src.includes('contextsState.error'),
      'HomeDashboard must render contextsState.error',
    )
    assert.ok(
      src.includes("Couldn't load contexts") || src.includes("Couldn"),
      'HomeDashboard must show contexts error message',
    )
  })

  it('HomeDashboard has retry for contexts error', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(
      src.includes('contextsState.refetch'),
      'HomeDashboard must have retry (refetch) for contexts error',
    )
  })
})

// ── Routes ────────────────────────────────────────────────

describe('Phase 3 — routes', () => {
  it('routes.ts exports all required route helpers', () => {
    const src = read('lib/routes.ts')
    assert.ok(src.includes('home'), 'routes must export home')
    assert.ok(src.includes('calendar'), 'routes must export calendar')
    assert.ok(src.includes('daily'), 'routes must export daily')
    assert.ok(src.includes('contexts'), 'routes must export contexts')
    assert.ok(src.includes('context'), 'routes must export context')
    assert.ok(src.includes('meeting'), 'routes must export meeting')
    assert.ok(src.includes('settings'), 'routes must export settings')
  })

  it('routes return strings starting with /', () => {
    const src = read('lib/routes.ts')
    const body = src.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const routeStrings = body.match(/['"`]\/[^'"`]*['"`]/g) || []
    assert.ok(routeStrings.length >= 6, 'routes should define at least 6 path strings')
    for (const s of routeStrings) {
      const val = s.slice(1, -1)
      assert.ok(val.startsWith('/'), `route "${val}" must start with /`)
    }
  })
})

// ── Design-system compliance ──────────────────────────────

describe('Phase 3 — design-system compliance', () => {
  it('globals.css defines background, surface, accent, and muted tokens', () => {
    const css = read('app/globals.css')
    assert.ok(css.includes('--background'), 'CSS must define --background token')
    assert.ok(css.includes('--surface'), 'CSS must define --surface token')
    assert.ok(css.includes('--accent'), 'CSS must define --accent token')
    assert.ok(css.includes('--muted'), 'CSS must define --muted token')
  })

  it('tailwind.config.js maps surface, background, accent, and muted', () => {
    const cfg = readRoot('tailwind.config.js')
    assert.ok(cfg.includes('surface'), 'tailwind config must map surface')
    assert.ok(cfg.includes('background'), 'tailwind config must map background')
    assert.ok(cfg.includes('accent'), 'tailwind config must map accent')
    assert.ok(cfg.includes('muted'), 'tailwind config must map muted')
  })
})

// ── Test/tooling existence ────────────────────────────────

describe('Phase 3 — test/tooling', () => {
  it('design-system-regression.test.mjs exists', () => {
    assert.ok(existsSync(join(testsDir, 'tests/lib/design-system-regression.test.mjs')))
  })

  it('branding-regression.test.ts exists', () => {
    assert.ok(existsSync(join(testsDir, 'tests/lib/branding-regression.test.ts')))
  })

  it('contract audit script exists', () => {
    assert.ok(existsSync(join(testsDir, 'tests/contract/audit.mjs')))
  })
})
