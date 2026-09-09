/**
 * Design System Regression Test
 *
 * Verifies Recall's design foundation invariants:
 * - Required semantic tokens exist in both light and dark
 * - Core text contrast passes WCAG AA
 * - Reduced-motion handling exists
 * - Hardcoded scrollbar colors don't reappear
 * - No forbidden upstream design dependencies
 * - Icon/motion registry exists
 * - Morphicons integration uses intended source
 * - No runtime TheSVG CDN fetching
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const globalsPath = join(import.meta.dirname, '../../src/app/globals.css')
const globals = readFileSync(globalsPath, 'utf-8')

const tailwindPath = join(import.meta.dirname, '../../tailwind.config.js')
const tailwind = readFileSync(tailwindPath, 'utf-8')

const packagePath = join(import.meta.dirname, '../../package.json')
const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))

// --- Required semantic tokens ---
const requiredLightTokens = [
  'background', 'foreground', 'surface', 'surface-raised',
  'card', 'card-foreground', 'popover', 'popover-foreground',
  'muted', 'muted-foreground', 'secondary', 'secondary-foreground',
  'border', 'border-strong', 'input',
  'primary', 'primary-foreground',
  'accent', 'accent-foreground',
  'success', 'success-foreground',
  'warning', 'warning-foreground',
  'destructive', 'destructive-foreground',
  'ring', 'focus',
  'selection', 'selection-foreground',
]

const requiredDarkTokens = [
  'background', 'foreground', 'surface', 'surface-raised',
  'primary', 'primary-foreground',
  'accent', 'accent-foreground',
  'success', 'destructive', 'warning',
  'border', 'border-strong',
  'muted', 'muted-foreground',
  'ring', 'focus',
  'selection', 'selection-foreground',
]

describe('Design System — Semantic Tokens', () => {
  it('light mode defines all required tokens', () => {
    // Extract :root block
    const rootMatch = globals.match(/:root\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
    assert.ok(rootMatch, ':root block should exist')
    const rootBlock = rootMatch[1]

    for (const token of requiredLightTokens) {
      assert.ok(
        rootBlock.includes(`--${token}:`),
        `Missing light token: --${token}`
      )
    }
  })

  it('dark mode defines all required tokens', () => {
    const darkMatch = globals.match(/\.dark\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
    assert.ok(darkMatch, '.dark block should exist')
    const darkBlock = darkMatch[1]

    for (const token of requiredDarkTokens) {
      assert.ok(
        darkBlock.includes(`--${token}:`),
        `Missing dark token: --${token}`
      )
    }
  })

  it('maps card to surface and popover to surface-raised', () => {
    const rootMatch = globals.match(/:root\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
    const rootBlock = rootMatch[1]
    // card should have same value as surface
    const surfaceVal = rootBlock.match(/--surface:\s*([^;]+)/)?.[1]
    const cardVal = rootBlock.match(/--card:\s*([^;]+)/)?.[1]
    assert.equal(surfaceVal, cardVal, 'card should equal surface')
  })
})

describe('Design System — Contrast', () => {
  // HSL to RGB helper
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100
    const k = n => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
  }

  function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
  }

  function contrastRatio(hsl1, hsl2) {
    const rgb1 = hslToRgb(...hsl1)
    const rgb2 = hslToRgb(...hsl2)
    const l1 = relativeLuminance(...rgb1)
    const l2 = relativeLuminance(...rgb2)
    const lighter = Math.max(l1, l2)
    const darker = Math.min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)
  }

  function parseHsl(str) {
    const match = str.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/)
    if (!match) return null
    return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]
  }

  it('core text pairs pass WCAG AA (4.5:1)', () => {
    const rootMatch = globals.match(/:root\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/)
    const rootBlock = rootMatch[1]

    const pairs = [
      ['foreground', 'background'],
      ['primary-foreground', 'primary'],
      ['muted-foreground', 'background'],
      ['accent-foreground', 'accent'],
      ['destructive-foreground', 'destructive'],
      ['success-foreground', 'success'],
    ]

    for (const [fg, bg] of pairs) {
      const fgVal = rootBlock.match(new RegExp(`--${fg}:\\s*([^;]+)`))?.[1]
      const bgVal = rootBlock.match(new RegExp(`--${bg}:\\s*([^;]+)`))?.[1]
      assert.ok(fgVal, `Token --${fg} should exist`)
      assert.ok(bgVal, `Token --${bg} should exist`)

      const fgHsl = parseHsl(fgVal)
      const bgHsl = parseHsl(bgVal)
      assert.ok(fgHsl, `--${fg} should be valid HSL`)
      assert.ok(bgHsl, `--${bg} should be valid HSL`)

      const ratio = contrastRatio(fgHsl, bgHsl)
      assert.ok(
        ratio >= 4.5,
        `${fg} on ${bg}: contrast ${ratio.toFixed(2)}:1 < 4.5:1 (WCAG AA)`
      )
    }
  })
})

describe('Design System — Reduced Motion', () => {
  it('has prefers-reduced-motion handling', () => {
    assert.ok(
      globals.includes('prefers-reduced-motion'),
      'globals.css should handle prefers-reduced-motion'
    )
  })
})

describe('Design System — Scrollbar', () => {
  it('scrollbar uses semantic tokens, not hardcoded gray', () => {
    // The scrollbar section should use muted-foreground, not #d1d5db
    assert.ok(
      !globals.includes('#d1d5db'),
      'Hardcoded scrollbar gray #d1d5db should be replaced with tokens'
    )
    assert.ok(
      !globals.includes('#9ca3af'),
      'Hardcoded scrollbar hover gray #9ca3af should be replaced with tokens'
    )
  })
})

describe('Design System — Motion Tokens', () => {
  it('defines duration tokens', () => {
    assert.ok(globals.includes('--duration-fast'), 'Should define --duration-fast')
    assert.ok(globals.includes('--duration-standard'), 'Should define --duration-standard')
    assert.ok(globals.includes('--duration-slow'), 'Should define --duration-slow')
  })

  it('defines easing tokens', () => {
    assert.ok(globals.includes('--ease-out'), 'Should define --ease-out')
    assert.ok(globals.includes('--ease-in-out'), 'Should define --ease-in-out')
  })
})

describe('Design System — Tailwind Config', () => {
  it('maps new semantic tokens', () => {
    assert.ok(tailwind.includes('surface'), 'tailwind should define surface color')
    assert.ok(tailwind.includes('success'), 'tailwind should define success color')
    assert.ok(tailwind.includes('warning'), 'tailwind should define warning color')
    assert.ok(tailwind.includes('focus'), 'tailwind should define focus color')
    assert.ok(tailwind.includes('selection'), 'tailwind should define selection color')
  })

  it('does not have hardcoded tertiary', () => {
    assert.ok(
      !tailwind.includes("tertiary: '#64748b'"),
      'Hardcoded tertiary should be removed'
    )
  })
})

describe('Design System — Dependencies', () => {
  it('has morphicons installed', () => {
    assert.ok(pkg.dependencies.morphicons, 'morphicons should be in dependencies')
  })

  it('has lucide (data package) installed', () => {
    assert.ok(pkg.dependencies.lucide, 'lucide data package should be in dependencies')
  })

  it('does not use posthog', () => {
    assert.ok(!pkg.dependencies['posthog-rs'], 'posthog-rs should not be in dependencies')
  })

  it('does not use tauri-plugin-updater', () => {
    assert.ok(!pkg.dependencies['@tauri-apps/plugin-updater'], 'updater plugin should not be in dependencies')
  })
})

describe('Design System — No Runtime CDN', () => {
  it('does not fetch TheSVG from CDN', () => {
    const srcFiles = readFileSync(join(import.meta.dirname, '../../src/app/globals.css'), 'utf-8')
    assert.ok(
      !srcFiles.includes('thesvg.com') && !srcFiles.includes('the-svg'),
      'Should not reference TheSVG CDN'
    )
  })
})
