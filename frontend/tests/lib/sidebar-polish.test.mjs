/**
 * Sidebar / desktop shell polish regression gate.
 *
 * Locks the structural guarantees that make the sidebar behave like a desktop
 * shell rather than a long scrolling list:
 *
 *   1. the meeting history is the ONLY independently scrollable region
 *   2. that region is properly bounded (flex-1 + min-h-0 + overflow-y-auto)
 *   3. the footer is a sibling of the scroll region, so a long history cannot
 *      push it below the viewport
 *   4. navigation rows are derived from shared constants, so they cannot drift
 *   5. the collapsed rail keeps every control and its accessible name
 *   6. recording state stays visible and distinguishable from the idle action
 *   7. Recall branding is intact and no upstream branding returns
 *   8. only semantic tokens are used
 *   9. Settings is presented once, not duplicated in nav and footer
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

const sidebar = read('src/components/Sidebar/index.tsx')
const info = read('src/components/Info.tsx')
const logo = read('src/components/Logo.tsx')
const mainContent = read('src/components/MainContent/index.tsx')
const about = read('src/components/About.tsx')

describe('sidebar: scroll architecture', () => {
  it('the meeting list is the only independently scrollable region', () => {
    const scrollers = sidebar.match(/overflow-y-auto/g) || []
    assert.equal(
      scrollers.length,
      1,
      `expected exactly one overflow-y-auto region, found ${scrollers.length}`,
    )
    // ...and it is the meeting list, inside the content column.
    assert.match(sidebar, /flex-1 overflow-y-auto custom-scrollbar min-h-0"/)
  })

  it('the scroll region is bounded so it can never grow past the panel', () => {
    // flex-1 alone will not shrink below content size; min-h-0 is what makes
    // the inner column actually bounded inside the flex parent.
    assert.match(sidebar, /flex-1 overflow-y-auto custom-scrollbar min-h-0/)
    // The panel itself must have a definite height for any of this to matter.
    assert.match(sidebar, /h-screen[^"]*flex flex-col/)
  })

  it('the footer is a direct child of the panel, alongside the main column', () => {
    const scrollIdx = sidebar.indexOf('flex-1 overflow-y-auto custom-scrollbar min-h-0')
    const footerIdx = sidebar.indexOf('{/* Footer')
    // Anchor on the main column specifically: it carries `overflow-hidden` as a
    // hard guarantee that nothing in it can paint into the footer strip.
    const mainColIdx = sidebar.indexOf('flex-1 flex flex-col min-h-0 overflow-hidden')
    assert.ok(scrollIdx > 0, 'meeting list container must exist')
    assert.ok(footerIdx > scrollIdx, 'footer must come after the scroll region')
    assert.ok(mainColIdx > 0 && mainColIdx < scrollIdx, 'main column must wrap the scroll region')

    // The invariant that keeps the footer on screen: the footer and the main
    // content column are siblings directly inside the panel. The meeting list
    // is nested *inside* the main column, so no amount of history can displace
    // the footer — the column is the only thing that flexes.
    const lines = sidebar.split('\n')
    // idx is a character offset, so count newlines rather than slicing lines.
    const lineOf = (idx) => sidebar.slice(0, idx).split('\n').length - 1
    const indentOf = (idx) => lines[lineOf(idx)].match(/^\s*/)[0].length

    assert.equal(
      indentOf(footerIdx),
      indentOf(mainColIdx),
      'footer and main column must be siblings at the same depth inside the panel',
    )
    assert.ok(
      indentOf(scrollIdx) > indentOf(mainColIdx),
      'the scroll region must be nested inside the main column, not beside the footer',
    )
  })

  it('the main column clips its own overflow so it cannot reach the footer', () => {
    assert.match(
      sidebar,
      /flex-1 flex flex-col min-h-0 overflow-hidden/,
      'the middle column must clip, not just flex',
    )
  })

  it('the footer and the main content column are both flex-shrink-0 or bounded', () => {
    assert.match(sidebar, /flex-1 flex flex-col min-h-0 overflow-hidden/)
    assert.match(
      sidebar,
      /flex-shrink-0 border-t border-border bg-surface px-3 py-2\.5 relative z-10/,
    )
  })
})

describe('sidebar: row system', () => {
  it('navigation rows are derived from shared constants, not inline per row', () => {
    assert.match(sidebar, /const ROW_BASE =/)
    assert.match(sidebar, /const ROW_IDLE =/)
    assert.match(sidebar, /const ROW_ACTIVE =/)
    assert.match(sidebar, /const ROW_H =/)

    // Every primary nav row composes the constants rather than restating
    // padding/height/focus by hand.
    const composed = sidebar.match(/\$\{ROW_BASE\}/g) || []
    assert.ok(
      composed.length >= 6,
      `expected nav + footer rows to share ROW_BASE, found ${composed.length}`,
    )
  })

  it('no nav row restates its own height, radius or focus ring', () => {
    const navBlock = sidebar.slice(sidebar.indexOf('const SECTION_LABEL'))
    assert.ok(
      !/h-10 flex mx-3/.test(navBlock),
      'legacy inline nav row geometry must be gone',
    )
    assert.ok(!/rounded-lg cursor-pointer/.test(navBlock), 'legacy nav row styling must be gone')
  })

  it('the active state is a restrained accent wash plus an accent bar', () => {
    assert.match(sidebar, /const ROW_ACTIVE =\s*\n?\s*'bg-accent\/20 text-foreground font-medium'/)
    assert.match(sidebar, /const ACTIVE_BAR = \(/)
    // The old full-strength accent block must not be used for nav rows.
    assert.ok(
      !/bg-accent text-accent-foreground/.test(sidebar),
      'solid accent blocks must not be used as the nav active state',
    )
  })

  it('section labels share one token set and align with the rows', () => {
    assert.match(sidebar, /const SECTION_LABEL = 'px-3 pt-5 pb-1\.5 text-label text-muted-foreground'/)
    const labels = sidebar.match(/<div className=\{SECTION_LABEL\}>/g) || []
    assert.equal(labels.length, 2, 'Meetings and Knowledge labels expected')
  })
})

describe('sidebar: meeting history rows', () => {
  it('meeting titles truncate instead of wrapping', () => {
    assert.ok(
      !sidebar.includes('break-words'),
      'a wrapping title makes row height variable and breaks scannability',
    )
    assert.match(sidebar, /<span className="flex-1 truncate">\{item\.title\}<\/span>/)
  })

  it('a long title is still reachable and announced in full', () => {
    assert.match(sidebar, /title=\{item\.title\}/)
    assert.match(sidebar, /aria-label=\{`Edit title for \$\{item\.title\}`\}/)
  })

  it('history rows are a fixed height', () => {
    assert.match(sidebar, /const rowTone =/)
    assert.match(sidebar, /\$\{ROW_BASE\} \$\{ROW_H\}/)
  })

  it('hover actions do not permanently steal width from the title', () => {
    // `opacity-0` keeps an element in flow, which silently ate ~60px and
    // truncated every meeting name. The actions must be taken out of flow.
    assert.ok(
      /absolute right-1 top-1\/2 -translate-y-1\/2[\s\S]{0,200}opacity-0/.test(sidebar),
      'row hover actions must be absolutely positioned',
    )
    assert.ok(
      !/className="flex items-center gap-0\.5 pl-1 opacity-0/.test(sidebar),
      'in-flow opacity-0 actions must be gone',
    )
  })
})

describe('sidebar: footer action hierarchy', () => {
  it('Start Recording is the only prominent footer action', () => {
    const footer = sidebar.slice(sidebar.indexOf('{/* Footer'))
    const prominent = footer.match(/bg-destructive text-destructive-foreground|bg-primary text-primary-foreground/g) || []
    assert.ok(prominent.length <= 1, 'only the primary action should be a solid block')
    assert.match(footer, /bg-destructive text-destructive-foreground hover:bg-destructive\/90/)
  })

  it('the recording state is visibly distinct from the idle action', () => {
    const footer = sidebar.slice(sidebar.indexOf('{/* Footer'))
    assert.match(footer, /Recording in progress/)
    assert.match(
      footer,
      /bg-destructive\/10 text-destructive border border-destructive\/40/,
      'active recording must read as a status, not a solid button',
    )
    assert.match(footer, /motion-safe:animate-pulse motion-reduce:animate-none/)
  })

  it('utility actions are compact and grouped', () => {
    const footer = sidebar.slice(sidebar.indexOf('{/* Footer'))
    assert.match(footer, /const ROW_H_UTILITY|ROW_H_UTILITY/)
    assert.match(footer, /<div className="mt-1 flex items-center gap-1">/)
    // Settings and About share one row.
    assert.match(footer, /Import Audio[\s\S]*Settings[\s\S]*<Info isCollapsed=\{isCollapsed\} \/>/)
  })

  it('the version is subordinate, not another navigation row', () => {
    const footer = sidebar.slice(sidebar.indexOf('{/* Footer'))
    assert.match(footer, /<p className="mt-2 text-center text-caption text-muted-foreground">\s*Recall v0\.4\.0/)
    assert.ok(!footer.includes('v0.4.0</div>'), 'version must not be a button-styled block')
  })
})

describe('sidebar: settings and about', () => {
  it('Settings is presented once in the expanded sidebar', () => {
    // Only the expanded navigation block — the collapsed rail legitimately has
    // its own Settings icon, and the footer owns the expanded Settings row.
    const navBlock = sidebar.slice(
      sidebar.indexOf('<div className="flex-shrink-0">'),
      sidebar.indexOf('{/* Content area */}'),
    )
    assert.ok(navBlock.length > 0, 'expanded nav block must exist')
    assert.ok(
      !navBlock.includes('>System<'),
      'the SYSTEM nav section is redundant now that Settings lives in the footer',
    )
    assert.ok(
      !navBlock.includes("router.push('/settings')"),
      'Settings must not also be a navigation row',
    )
  })

  it('Settings keeps aria-current when it is the active page', () => {
    const footer = sidebar.slice(sidebar.indexOf('{/* Footer'))
    assert.match(footer, /aria-current=\{pathname === '\/settings' \? 'page' : undefined\}/)
  })

  it('About is a compact utility that still opens the Recall dialog', () => {
    assert.match(info, /aria-label="About Recall"/)
    assert.match(info, /About \/>/)
    assert.match(info, /from "\.\/About"/)
    // Collapsed and expanded must share one control, not two designs.
    assert.match(info, /isCollapsed\s*\?\s*"flex h-9 w-9 shrink-0/)
  })

  it('the About panel stays Recall-only', () => {
    assert.ok(!/chat with/i.test(about), 'no vendor CTA in About')
    assert.ok(!/built by/i.test(about), 'no vendor credit in About')
    assert.ok(!/zackriya\.com/.test(about), 'no vendor URL in About')
    assert.match(about, /Recall is derived from the Meetily open-source project \(MIT licence\)/)
  })
})

describe('sidebar: collapsed rail', () => {
  it('the rail keeps an accessible name on every control', () => {
    const rail = sidebar.slice(
      sidebar.indexOf('const renderCollapsedIcons'),
      sidebar.indexOf('// Find matching transcript snippet'),
    )
    const labels = rail.match(/aria-label="[^"]+"/g) || []
    assert.ok(labels.length >= 7, `expected labelled rail controls, found ${labels.length}`)
    assert.match(rail, /aria-label=\{isRecording \? 'Stop Recording' : 'Start Recording'\}/)
  })

  it('rail buttons share one square footprint', () => {
    const rail = sidebar.slice(
      sidebar.indexOf('const renderCollapsedIcons'),
      sidebar.indexOf('// Find matching transcript snippet'),
    )
    const squares = rail.match(/flex h-9 w-9 items-center justify-center rounded-md/g) || []
    assert.ok(squares.length >= 6, `expected uniform rail buttons, found ${squares.length}`)
    assert.ok(!rail.includes('space-y-4'), 'the rail must not use loose spacing')
  })

  it('the rail active state matches the expanded sidebar', () => {
    const rail = sidebar.slice(
      sidebar.indexOf('const renderCollapsedIcons'),
      sidebar.indexOf('// Find matching transcript snippet'),
    )
    assert.ok(
      !rail.includes('bg-accent text-accent-foreground'),
      'collapsed and expanded must not use different active treatments',
    )
  })

  it('the rail still offers tooltips', () => {
    const rail = sidebar.slice(
      sidebar.indexOf('const renderCollapsedIcons'),
      sidebar.indexOf('// Find matching transcript snippet'),
    )
    const tooltips = rail.match(/<TooltipContent/g) || []
    assert.ok(tooltips.length >= 6, `expected rail tooltips, found ${tooltips.length}`)
  })
})

describe('sidebar: tokens, identity and motion', () => {
  it('uses semantic tokens only', () => {
    const palette =
      /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|accent|decoration)-(?:gray|white|black|blue|red|green|amber|yellow|indigo|purple|pink|emerald|cyan|sky|violet|rose|orange|teal|lime|fuchsia|slate|zinc|neutral|stone)(?:-[0-9]{2,3})?\b/
    assert.ok(!palette.test(sidebar), 'sidebar must not hardcode palette classes')
    assert.ok(!palette.test(info), 'About trigger must not hardcode palette classes')
  })

  it('keeps the Recall identity in the sidebar', () => {
    assert.match(logo, /aria-label="About Recall"/)
    assert.match(logo, /logo-collapsed\.png/)
    assert.ok(!/meetily|zackriya/i.test(sidebar), 'no upstream branding in the sidebar')
  })

  it('no malformed opacity utilities', () => {
    assert.ok(!/\/[0-9]+\/[0-9]+/.test(sidebar), 'malformed opacity modifier')
  })

  it('animated elements opt out under reduced motion', () => {
    const animated = sidebar.match(/\banimate-(spin|pulse|bounce|ping)\b/g) || []
    if (animated.length > 0) {
      assert.match(sidebar, /motion-reduce:animate-none|motion-safe:animate-/)
    }
  })

  it('does not use alert/confirm/prompt', () => {
    assert.ok(!/\balert\(/.test(sidebar))
    assert.ok(!/\bconfirm\(/.test(sidebar))
    assert.ok(!/window\.prompt/.test(sidebar))
  })
})

describe('shell: main content adapts to the sidebar', () => {
  /*
   * CONTRACT CHANGE (Phase A1, deliberate).
   *
   * These two assertions previously required the sidebar panel and the main
   * offset to restate the widths inline (`isCollapsed ? 'w-16' : 'w-64'` and
   * `isCollapsed ? 'ml-16' : 'ml-64'`) and then checked the two numbers agreed.
   *
   * That mechanism was the bug: the same two widths were restated four times
   * across the sidebar, MainContent, and two fixed overlays, so they could and
   * did drift. A1 replaced the literals with one source of truth
   * (`lib/sidebar-layout.ts` over CSS custom properties) and every consumer
   * now calls `sidebarWidth()`.
   *
   * The INTENT is unchanged and still enforced: the panel width and the main
   * content offset are derived from the same source, so they cannot disagree.
   */
  it('the sidebar panel and main content both resolve width from one source', () => {
    assert.match(sidebar, /sidebarWidth\(isCollapsed\)/)
    assert.match(mainContent, /sidebarWidth\(isCollapsed\)/)
  })

  it('neither the panel nor the offset restates the width inline', () => {
    // If these literals ever reappear, the single source of truth is broken.
    assert.doesNotMatch(sidebar, /\b(?:ml|w)-(?:16|64)\b/)
    assert.doesNotMatch(mainContent, /\b(?:ml|w)-(?:16|64)\b/)
    assert.doesNotMatch(sidebar, /'4rem'|'16rem'/)
    assert.doesNotMatch(mainContent, /'4rem'|'16rem'/)
  })
})
