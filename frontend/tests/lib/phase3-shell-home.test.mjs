/**
 * Phase 3 — Shell + Home Regression Test
 *
 * Verifies:
 * - Sidebar uses semantic tokens (no hardcoded gray/white/blue/red)
 * - HomeDashboard uses semantic tokens (no hardcoded gray/white/blue)
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
    // Strip comments so commented-out legacy code doesn't trigger false positives
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

  it('HomeDashboard uses bg-surface for card sections', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(src.includes('bg-surface'), 'HomeDashboard cards must use bg-surface')
  })

  it('HomeDashboard uses text-foreground for headings', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    const foregroundCount = (src.match(/text-foreground/g) || []).length
    assert.ok(
      foregroundCount >= 5,
      `HomeDashboard should use text-foreground for headings (found ${foregroundCount})`,
    )
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

  it('HomeDashboard uses border-border for card borders', () => {
    const src = read('components/Home/HomeDashboard.tsx')
    assert.ok(src.includes('border-border'), 'HomeDashboard cards must use border-border')
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
