/**
 * Phase D -- design system polish regression gate.
 *
 * This is a POLISH pass on top of the accepted Phase 5 foundation, not a new
 * product phase. It encodes the invariants that the polish pass established,
 * so a later change cannot quietly undo them.
 *
 * What is locked in here, and why each one exists:
 *
 *   1. Zero raw Tailwind palette utilities in src/. Colour was migrated from
 *      raw hues to semantic tokens (primary / success / warning / destructive /
 *      muted / surface / border). Raw hues are unreadable in dark mode and
 *      bypass the theme. A tint must be expressed as `bg-primary/10`, never
 *      `bg-blue-50`, which is a near-white box on Recall's dark surface.
 *   2. Zero inline hex colours in src/. The last two were the track and fill
 *      strokes of the circular download ring; they are now `stroke-border` and
 *      `stroke-primary`.
 *   3. Zero `transition-all`. It animates properties the element never
 *      changes, so it forces main-thread work on unrelated paints. Every
 *      transition in the app names its properties.
 *   4. Zero `dark:` paired with a raw palette hue. Recall defines a full
 *      token set per theme, so a `dark:` hue override is a bypass, not a need.
 *      (`dark:` on a TOKEN is fine and is not matched by this gate.)
 *   5. The radius ladder ASCENDS. design-token-integrity.test.mjs documented
 *      the ladder as inverted and explicitly deferred the ordering fix to "a
 *      dedicated, visually verified design-system pass". That assertion was
 *      removed there on purpose so it could be added back here, once the
 *      correction had actually been rendered and inspected in WebView2 rather
 *      than reasoned about on paper.
 *   6. `--scrim` exists in BOTH themes and is mapped in tailwind.config.js.
 *      A modal/drop scrim is not a surface, so no existing token expressed
 *      "darken whatever is behind me" -- but leaving it as a raw palette
 *      colour would be a permanent exception to rule 1.
 *   7. Settings section headings are token-derived, and the two heading levels
 *      do not contradict each other.
 *   8. The Meetings and Notes archive rows share one height, so the two list
 *      screens have a single row rhythm.
 *   9. Home presents exactly one visually dominant CTA. Generate Daily Brief
 *      is a status/secondary action per the PRD and must not compete with
 *      Start Recording.
 *  10. Animation is disabled under prefers-reduced-motion, with an explicit,
 *      documented exception for the loading spinner.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

const tailwindConfig = read('tailwind.config.js')
const globals = read('src/app/globals.css')

function filesUnder(dir = 'src', exts = ['.tsx', '.ts'], acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) filesUnder(rel, exts, acc)
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(rel)
  }
  return acc
}

const SRC = [...filesUnder('src', ['.tsx', '.ts']), 'src/app/globals.css']
const hits = (pattern) => {
  const found = []
  for (const rel of SRC) {
    const src = read(rel)
    for (const m of src.matchAll(pattern)) {
      const line = src.slice(0, m.index).split('\n').length
      found.push(`${rel}:${line} -> ${m[0].trim()}`)
    }
  }
  return found
}

// Tailwind's default palette. Matches bg-/text-/border-/ring-/from-/via-/to-/
// fill-/stroke-/divide-/outline-/placeholder-/decoration-/accent-, each with an
// arbitrary variant prefix chain.
const HUES = 'gray|white|black|slate|zinc|neutral|stone|red|blue|green|amber|yellow|lime|indigo|purple|pink|emerald|cyan|sky|violet|rose|orange|teal|fuchsia'
const PALETTE_UTIL = new RegExp(
  `(?:[a-z-]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|placeholder|decoration|accent)-(${HUES})(?:-[0-9]{2,3})?\\b`,
  'g',
)

describe('phase D: colour is expressed only through semantic tokens', () => {
  it('no raw Tailwind palette utility survives in src/', () => {
    const found = hits(PALETTE_UTIL)
    assert.deepEqual(found, [], `raw palette utilities must become semantic tokens:\n  ${found.join('\n  ')}`)
  })

  it('no inline hex colour survives in src/', () => {
    const found = hits(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)
    assert.deepEqual(found, [], `inline hex colours bypass the theme:\n  ${found.join('\n  ')}`)
  })

  it('no dark: variant is paired with a raw palette hue', () => {
    const found = hits(new RegExp(`dark:(?:bg|text|border|ring|fill|stroke)-(${HUES})(?:-[0-9]{2,3})?\\b`, 'g'))
    assert.deepEqual(
      found,
      [],
      `Recall defines a full token set per theme, so a dark: hue override is a bypass:\n  ${found.join('\n  ')}`,
    )
  })

  it('every colour utility in components/ui is a token', () => {
    const found = []
    for (const name of readdirSync('src/components/ui').filter((f) => f.endsWith('.tsx'))) {
      const rel = `src/components/ui/${name}`
      for (const m of read(rel).matchAll(PALETTE_UTIL)) found.push(`${rel} -> ${m[0].trim()}`)
    }
    assert.deepEqual(found, [], `primitives are the base of the system:\n  ${found.join('\n  ')}`)
  })
})

describe('phase D: the scrim token is real in both themes', () => {
  it('--scrim is declared in :root and in the dark block', () => {
    const root = globals.match(/:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const dark = globals.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    assert.match(root, /--scrim:\s*[\d.]+[\s%]+[\d.]+%\s*[\d.]+%/, '--scrim must be declared in :root')
    assert.match(dark, /--scrim:\s*[\d.]+[\s%]+[\d.]+%\s*[\d.]+%/, '--scrim must be re-declared for dark mode')
  })

  it('the scrim colour is mapped in tailwind.config.js', () => {
    assert.match(tailwindConfig, /scrim:\s*'hsl\(var\(--scrim\)\)'/, 'scrim token must be mapped to a utility')
  })

  it('no overlay scrim is built from the foreground token', () => {
    // Verified in the running app: dialog.tsx used `bg-foreground/50`, which
    // resolves to a LIGHT wash in dark mode (rgba(245,243,237,0.5)) and a dark
    // one in light mode -- the exact inverse of a scrim. A dialog backdrop that
    // turns milky in dark mode reads as fog, not depth, and it inverts on every
    // theme change. A scrim must not depend on the theme at all.
    const offenders = []
    for (const rel of ['src/components/ui/dialog.tsx', 'src/components/ui/sheet.tsx']) {
      const src = read(rel)
      if (/fixed inset-0[^"`]*bg-foreground/.test(src)) offenders.push(rel)
    }
    assert.deepEqual(
      offenders,
      [],
      `overlay backdrops must use the scrim token, not bg-foreground:\n  ${offenders.join('\n  ')}`,
    )
  })
})

describe('phase D: the radius ladder ascends', () => {
  const block = tailwindConfig.match(/borderRadius:\s*\{([\s\S]*?)\n\s*\}/)
  const steps = Object.fromEntries(
    [...(block?.[1] ?? '').matchAll(/(\w+):\s*'([^']+)'/g)].map(([, k, v]) => [k, v]),
  )

  /**
   * Resolves each step to px against the declared --radius so the ordering can
   * be asserted numerically instead of by eye.
   */
  function px(value) {
    const base = Number(globals.match(/--radius:\s*([\d.]+)rem/)?.[1] ?? 0) * 16
    if (value === 'var(--radius)') return base
    const m = value.match(/calc\(var\(--radius\)\s*([+-])\s*(\d+)px\)/)
    assert.ok(m, `borderRadius step "${value}" is not derived from --radius`)
    return base + (m[1] === '+' ? 1 : -1) * Number(m[2])
  }

  it('the ladder is defined', () => {
    assert.ok(block, 'could not locate the borderRadius block')
    for (const step of ['sm', 'md', 'lg']) assert.ok(steps[step], `borderRadius.${step} must be defined`)
  })

  it('sm <= md <= lg, so a larger step is never sharper than a smaller one', () => {
    const sm = px(steps.sm)
    const md = px(steps.md)
    const lg = px(steps.lg)
    assert.ok(sm < md, `rounded-sm (${sm}px) must be sharper than rounded-md (${md}px)`)
    assert.ok(md < lg, `rounded-md (${md}px) must be sharper than rounded-lg (${lg}px)`)
  })

  it('overlay containers use the lg step and controls use the md step', () => {
    // dialog/popover/dropdown/select are floating panels; buttons/inputs are
    // the controls inside them. The old inversion made the panels look sharper
    // than the controls they contain.
    for (const [name, rel] of [
      ['dialog', 'src/components/ui/dialog.tsx'],
      ['popover', 'src/components/ui/popover.tsx'],
      ['dropdown menu', 'src/components/ui/dropdown-menu.tsx'],
      ['select content', 'src/components/ui/select.tsx'],
    ]) {
      assert.match(read(rel), /rounded-lg\b/, `${name} surface should use the lg step`)
    }
    assert.match(read('src/components/ui/button.tsx'), /rounded-md/, 'button control should use the md step')
    // The select trigger is a control, not a panel.
    const select = read('src/components/ui/select.tsx')
    assert.match(select, /flex h-9[^\n]*rounded-md\b/, 'select trigger should stay on the md step')
  })
})

describe('phase D: motion names its properties and honours reduced motion', () => {
  it('no transition-all remains', () => {
    const found = hits(/transition-all/g)
    assert.deepEqual(
      found,
      [],
      `transition-all animates properties that never change:\n  ${found.join('\n  ')}`,
    )
  })

  it('prefers-reduced-motion is handled globally', () => {
    assert.match(
      globals,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
      'a global reduced-motion block must exist',
    )
  })

  it('the reduced-motion block disables looping/entrance animation utilities', () => {
    const reduced = globals.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    assert.ok(reduced.length > 0, 'could not read the reduced-motion block')
    // animate-spin is deliberately preserved: it reports live work in
    // progress, and a static spinner reads as a stalled app.
    for (const utility of ['animate-pulse', 'animate-ping']) {
      assert.match(reduced, new RegExp(utility), `${utility} must be disabled under reduced motion`)
    }
  })

  it('MotionConfig reducedMotion="user" wraps the app', () => {
    const layout = read('src/app/layout.tsx')
    assert.match(layout, /<MotionConfig[^>]*reducedMotion=["']user["']/, 'layout must defer to the OS setting')
  })
})

describe('phase D: headings and list rows stay coherent', () => {
  it('Settings section headings use the section-title token, not a hardcoded size', () => {
    const settings = [
      'src/components/BetaSettings.tsx',
      'src/components/RecordingSettings.tsx',
      'src/components/SummaryModelSettings.tsx',
      'src/components/TranscriptSettings.tsx',
      'src/app/_components/SettingsModal.tsx',
    ]
    const offenders = []
    for (const rel of settings) {
      for (const m of read(rel).matchAll(/<h3[^>]*className="([^"]+)"/g)) {
        if (!m[1].includes('text-section-title')) {
          offenders.push(`${rel} -> "${m[1]}"`)
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `h3 section headings must use the token (18px/600):\n  ${offenders.join('\n  ')}`,
    )
  })

  it('both Settings sub-heading levels agree on one weight', () => {
    const weights = new Set()
    for (const rel of [
      'src/components/RecordingSettings.tsx',
      'src/app/_components/SettingsModal.tsx',
    ]) {
      for (const m of read(rel).matchAll(/<h4[^>]*className="([^"]+)"/g)) {
        const w = m[1].match(/font-(semibold|bold|medium)/)?.[1]
        if (w) weights.add(w)
      }
    }
    assert.deepEqual([...weights], ['semibold'], `h4 sub-headings must share one weight, found ${[...weights]}`)
  })

  it('every route-level page title uses the page-title token', () => {
    // Verified in the running app: /settings rendered its h1 at 30px
    // (text-3xl) while Meetings and Notes rendered 24px (text-page-title), so
    // the Settings title was 25% larger than every other page title for no
    // reason. text-page-title is 24px/700, so this is size-preserving for the
    // pages that were already on it.
    const offenders = []
    for (const rel of [
      'src/app/settings/page.tsx',
      'src/components/Calendar/index.tsx',
      'src/components/DailyMeeting/index.tsx',
      'src/app/meetings/page.tsx',
      'src/app/notes/page.tsx',
    ]) {
      for (const m of read(rel).matchAll(/<h1[^>]*className="([^"]+)"/g)) {
        if (!m[1].includes('text-page-title')) offenders.push(`${rel} -> "${m[1]}"`)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `page titles must use text-page-title so every route has the same title size:\n  ${offenders.join('\n  ')}`,
    )
  })

  it('the Meetings and Notes archive rows share one height', () => {
    const rowHeight = (rel) => read(rel).match(/<ListRow[\s\S]*?className="([^"]*min-h-[^"]*)"/)?.[1] ?? ''
    const meetings = rowHeight('src/app/meetings/page.tsx')
    const notes = rowHeight('src/app/notes/page.tsx')
    const m = meetings.match(/min-h-(\w+)/)?.[1]
    const n = notes.match(/min-h-(\w+)/)?.[1]
    assert.ok(m, 'could not read the Meetings row height')
    assert.equal(n, m, `Meetings rows are min-h-${m} but Notes rows are min-h-${n}; the two archives must share one row rhythm`)
  })
})

describe('phase D: Home presents one dominant CTA', () => {
  const home = read('src/components/Home/HomeDashboard.tsx')

  it('Generate Daily Brief is not a second primary action', () => {
    const block = home.match(/<Button[\s\S]{0,400}?Generate Daily Brief[\s\S]{0,60}?<\/Button>/)?.[0] ?? ''
    assert.ok(block, 'could not locate the Generate Daily Brief button')
    assert.doesNotMatch(
      block,
      /variant="default"/,
      'Daily Brief is a status/secondary action per the PRD and must not compete with Start Recording',
    )
  })

  it('Start Recording and Generate Daily Brief do not both render as filled primaries', () => {
    const filled = [...home.matchAll(/<Button[\s\S]{0,120}?variant="default"/g)].length
    assert.equal(
      filled,
      1,
      `Home should not stack multiple filled primary buttons (found ${filled} variant="default" buttons)`,
    )
  })
})
