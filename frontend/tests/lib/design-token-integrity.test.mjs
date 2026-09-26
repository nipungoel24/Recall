/**
 * Design-token integrity regression gate.
 *
 * SCOPE — this gate protects the SAFE TRANCHE only. It encodes confirmed
 * defects that were reproduced and fixed, and it deliberately does NOT encode
 * the deferred radius redesign (see "radius scale" below).
 *
 * Confirmed defects this gate locks in:
 *
 *   1. focus rings named no offset colour, and Tailwind v3 defaults
 *      --tw-ring-offset-color to #fff, producing a hard white halo on every
 *      focused control in dark mode
 *   2. the Tailwind `content` globs omitted src/lib, src/hooks, src/contexts
 *      and src/services, so classNames in those files were never generated and
 *      those surfaces shipped unstyled
 *   3. surfaces hardcoded bg-white / bg-gray-* / border-gray-* / text-gray-*
 *      instead of semantic tokens, which is unreadable in dark mode and
 *      ignores the theme
 *   4. a colour migration collapsed an interactive hover state onto its own
 *      rest state, silently deleting the affordance
 *
 * DELIBERATELY DEFERRED — the `borderRadius` ladder in tailwind.config.js is
 * known to be inverted (`md` resolves larger than `lg`, so buttons/inputs come
 * out rounder than dialogs). Correcting it retints roughly 200 call sites and
 * was NOT visually verified, because WebView2 content could not be captured
 * reliably in this environment. The only assertion below is structural: the
 * scale must stay derived from --radius rather than hardcoded pixels. The
 * ordering fix belongs in a dedicated, visually verified design-system pass.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

const tailwindConfig = read('tailwind.config.js')
const globals = read('src/app/globals.css')

/** Every .tsx under src/, as repo-relative posix paths. */
function tsxFiles(dir = 'src', acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) tsxFiles(rel, acc)
    else if (entry.name.endsWith('.tsx')) acc.push(rel)
  }
  return acc
}

/**
 * Every className value in a file, including ternaries inside template
 * literals (`className={`... ${ok ? 'a' : 'b'}`}`). Scanning only
 * className="..." misses conditional branches, which is where a token
 * migration most easily collapses a hover state.
 */
function classNameValues(src) {
  const out = []
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

const UI = 'src/components/ui'
const uiFiles = readdirSync(UI).filter((f) => f.endsWith('.tsx'))
const ALL_TSX = tsxFiles()

describe('design tokens: radius scale stays token-derived', () => {
  it('every borderRadius step resolves from --radius, not a hardcoded pixel', () => {
    const block = tailwindConfig.match(/borderRadius:\s*\{([\s\S]*?)\n\s*\}/)
    assert.ok(block, 'could not locate the borderRadius block')

    const steps = [...block[1].matchAll(/(\w+):\s*'([^']+)'/g)]
    assert.ok(steps.length >= 3, `expected a multi-step radius scale, found ${steps.length}`)

    for (const [, name, value] of steps) {
      const tokenDerived =
        value === 'var(--radius)' ||
        /calc\(var\(--radius\)\s*[+-]\s*\d+px\)/.test(value)
      assert.ok(
        tokenDerived,
        `borderRadius.${name} = "${value}" is not derived from --radius; ` +
          `radius must stay theme-driven`,
      )
    }
  })

  it('--radius is defined once for both themes', () => {
    const root = globals.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    assert.match(root, /--radius:\s*[\d.]+rem/, '--radius must be declared in :root')
  })

  // NOTE: the ascending-ordering assertion was intentionally removed. The
  // current ladder is inverted and fixing it is deferred to a visually
  // verified pass. See the file header.
})

describe('design tokens: focus rings are theme-aware', () => {
  it('no primitive offsets a ring without naming the offset colour', () => {
    const offenders = []
    for (const f of uiFiles) {
      const src = read(`${UI}/${f}`)
      if (/focus-visible:ring-offset-2/.test(src) && !/ring-offset-background/.test(src)) {
        offenders.push(f)
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these primitives get a white focus halo in dark mode: ${offenders.join(', ')}`,
    )
  })

  it('the primary interactive primitives declare a focus-visible ring', () => {
    for (const f of ['button.tsx', 'input.tsx', 'textarea.tsx', 'tabs.tsx']) {
      assert.ok(/focus-visible:ring/.test(read(`${UI}/${f}`)), `${f} has no focus-visible ring`)
    }
  })

  it('focus rings are not left on a hardcoded light colour', () => {
    const offenders = ALL_TSX.filter((f) =>
      /focus-visible:ring-(?:white|gray|neutral)-\d{2,3}\b/.test(read(f)),
    )
    assert.deepEqual(offenders, [], `focus rings must use the ring token: ${offenders.join(', ')}`)
  })
})

describe('design tokens: Tailwind scans every directory that renders JSX', () => {
  it('content globs cover lib, hooks, contexts and services', () => {
    for (const dir of ['lib', 'hooks', 'contexts', 'services']) {
      assert.ok(
        tailwindConfig.includes(`'./src/${dir}/**/*`),
        `tailwind content is missing ./src/${dir}/**, so its classNames are never generated`,
      )
    }
  })

  it('the previously-omitted lib/ directory really does render classNames', () => {
    // Guards against the glob being narrowed again, and against widening it
    // for a directory that no longer renders JSX.
    const libTsx = tsxFiles('src/lib')
    assert.ok(libTsx.length > 0, 'expected .tsx files under src/lib')
    const withClasses = libTsx.filter((f) => /className=/.test(read(f)))
    assert.ok(
      withClasses.length > 0,
      'expected at least one src/lib .tsx to use className (the original symptom)',
    )
  })

  it('recordingNotification is covered and no longer carries raw palette', () => {
    const src = read('src/lib/recordingNotification.tsx')
    assert.ok(/className=/.test(src), 'recordingNotification should render classNames')
    assert.doesNotMatch(
      src,
      /\b(?:bg-white|bg-gray-\d{2,3}|border-gray-\d{2,3}|text-gray-\d{2,3})\b/,
      'recordingNotification must use semantic tokens now that its classes compile',
    )
  })
})

describe('design tokens: surfaces are theme-aware, not light-locked', () => {
  it('no component hardcodes a raw neutral surface, border or ink', () => {
    const RAW =
      /\b(?:bg-white|bg-gray-\d{2,3}|border-gray-\d{2,3}|divide-gray-\d{2,3}|text-gray-\d{2,3}|ring-gray-\d{2,3})\b/
    const offenders = ALL_TSX.filter((f) => RAW.test(read(f)))
    assert.deepEqual(
      offenders,
      [],
      `these files hardcode a neutral palette value: ${offenders.join(', ')}`,
    )
  })

  it('no dialog overrides DialogContent back to a fixed background', () => {
    const offenders = ALL_TSX.filter((f) => /DialogContent[^>\n]*\bbg-(?:white|gray-\d)/.test(read(f)))
    assert.deepEqual(offenders, [], `dialogs must inherit bg-background: ${offenders.join(', ')}`)
  })
})

describe('design tokens: interactive states stay distinguishable', () => {
  it('no hover/focus state is a complete no-op against its rest state', () => {
    // A migration that maps `text-gray-400 hover:text-gray-600` onto a single
    // token silently deletes the affordance while looking correct in review.
    //
    // A variant group only counts as collapsed when EVERY utility in it already
    // appears in the rest state. `text-destructive hover:bg-destructive/10
    // hover:text-destructive` still reads as a hover, because the background
    // changes — that redundancy is harmless, whereas a group with no new
    // utility at all is invisible to the user.
    const offenders = []
    for (const f of ALL_TSX) {
      const src = read(f)
      for (const value of classNameValues(src)) {
        // Conditional branches are separate states; compare each one on its own.
        const branches = value.split(/\$\{[^}]*\}/).length > 1
          ? [value, ...(value.match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1))]
          : [value]

        for (const branch of branches) {
          const classes = branch.split(/\s+/).filter(Boolean)
          if (classes.length === 0) continue
          const rest = new Set(
            classes.filter(
              (c) => !/^(hover|focus|focus-visible|active|disabled|group-|peer-|dark:)/.test(c),
            ),
          )
          for (const v of ['hover', 'focus', 'focus-visible', 'active']) {
            const group = classes.filter((c) => c.startsWith(`${v}:`))
            if (group.length === 0) continue
            // Every utility this variant applies must be new relative to rest.
            const introduces = group.some((c) => !rest.has(c.slice(v.length + 1)))
            if (!introduces) offenders.push(`${f} :: ${v}:* is a no-op -> "${branch.trim()}"`)
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `collapsed interaction states: ${offenders.join('; ')}`)
  })

  it('the AI Summary section header keeps a distinct hover colour', () => {
    const src = read('src/components/AISummary/Section.tsx')
    const raw = src.split('\n').find((l) => l.includes('hover:text-'))
    assert.ok(raw, 'expected Section.tsx to keep a hover:text- utility')

    // Read the className VALUE, so the `className="` prefix is not mistaken
    // for part of a utility name.
    const value = raw.match(/className="([^"]*)"/)?.[1]
    assert.ok(value, 'expected the hover to live on a className attribute')
    const tokens = value.split(/\s+/).filter(Boolean)

    const hover = tokens.filter((t) => t.startsWith('hover:text-')).map((t) => t.slice('hover:text-'.length))
    const rest = tokens.filter((t) => /^text-[a-z-]+$/.test(t)).map((t) => t.slice('text-'.length))

    assert.ok(hover.length > 0, 'expected a hover:text- colour')
    assert.ok(rest.length > 0, 'expected a rest text- colour')
    for (const h of hover) {
      assert.notEqual(h, rest[0], `Section.tsx hover (${h}) must differ from rest (${rest[0]})`)
    }
  })
})
