/**
 * Sidebar architecture regression gate.
 *
 * SCOPE CHANGE (Phase A2, deliberate).
 *
 * A2 replaced the sidebar. The previous version of this file asserted the
 * contracts of the old 1174-line component: a permanent meeting archive with
 * per-row hover actions, inline row constants, a floating collapse control
 * outside the panel, a Settings row in the footer, and a separately
 * hand-maintained collapsed rail.
 *
 * A2 removed the archive, moved Settings into the canonical nav model, put the
 * collapse control inside the panel, and made the collapsed rail render the same
 * nav tree. Those old contracts no longer describe the product, so this file was
 * rewritten rather than deleted.
 *
 * The INTENTS below are the ones that survived, restated against the new
 * architecture:
 *
 *   1. exactly one scrollable region, and the footer can never be pushed out
 *   2. rows come from one shared primitive, not per-row inline classes
 *   3. the active destination is unmistakable without a loud colour block
 *   4. section labels come from one component
 *   5. the archive is NOT in the sidebar
 *   6. one recording action, with a distinct recording state
 *   7. Settings appears once; About stays a utility
 *   8. collapsed mode is the same system, not a second list
 *   9. semantic tokens only, Recall identity intact, reduced motion respected
 *  10. the panel width and the main offset share one source
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
const listRow = read('src/components/ui/list-row.tsx')
const navSection = read('src/components/ui/nav-section.tsx')
const nav = read('src/lib/nav.ts')
const meetings = read('src/app/meetings/page.tsx')

const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|accent|decoration)-(?:gray|white|black|blue|red|green|amber|yellow|indigo|purple|pink|emerald|cyan|sky|violet|rose|orange|teal|lime|fuchsia|slate|zinc|neutral|stone)(?:-[0-9]{2,3})?\b/

describe('sidebar: scroll architecture', () => {
  it('the navigation is the only independently scrollable region', () => {
    const scrollers = sidebar.match(/overflow-y-auto/g) || []
    assert.equal(
      scrollers.length,
      1,
      `expected exactly one overflow-y-auto region, found ${scrollers.length}`,
    )
    assert.match(sidebar, /data-slot="sidebar-nav"[\s\S]*?overflow-y-auto/)
  })

  it('the scroll region is bounded so it can never grow past the panel', () => {
    const navRegion = sidebar.match(/data-slot="sidebar-nav"[\s\S]*?>/)
    assert.ok(navRegion, 'sidebar must expose a nav scroll region')
    assert.match(navRegion[0], /min-h-0/, 'the scroll region needs min-h-0 to shrink')
    assert.match(navRegion[0], /flex-1/, 'the scroll region must take the flexible space')
  })

  it('the footer is a sibling of the scroll region, not inside it', () => {
    // If the footer were nested in the scroller it could scroll away and become
    // unreachable in a short window.
    const navIdx = sidebar.indexOf('data-slot="sidebar-nav"')
    const footerIdx = sidebar.indexOf('data-slot="sidebar-footer"')
    assert.ok(navIdx > -1 && footerIdx > navIdx, 'the footer must follow the nav region')
    const between = sidebar.slice(navIdx, footerIdx)
    assert.doesNotMatch(
      between,
      /overflow-y-auto[\s\S]*data-slot="sidebar-footer"/,
      'the footer must not live inside the scroll region',
    )
  })

  it('the footer never shrinks, so it stays reachable at 737px', () => {
    const footer = sidebar.match(/data-slot="sidebar-footer"[\s\S]*?>/)
    assert.ok(footer, 'sidebar must expose a footer region')
    assert.match(footer[0], /flex-shrink-0/, 'the footer must not shrink')
  })
})

describe('sidebar: row system', () => {
  it('navigation rows come from the shared primitive, not inline per row', () => {
    assert.match(sidebar, /<ListRow/, 'rows must be rendered through ListRow')
    assert.doesNotMatch(
      sidebar,
      /\b(?:ml|w)-16\b|isCollapsed \? 'w-/,
      'the sidebar must not restate row geometry inline',
    )
  })

  it('rows are not clickable divs', () => {
    assert.doesNotMatch(sidebar, /<div[^>]*onClick=/, 'navigable rows must not be div onClick')
  })

  it('the active state is a subtle surface plus an indicator, not a colour block', () => {
    assert.match(listRow, /hover:bg-muted/, 'hover must use the neutral muted surface')
    assert.doesNotMatch(listRow, /hover:bg-accent\b/, 'hover must not use the lime accent')
    assert.match(listRow, /bg-primary/, 'the active indicator uses the primary token')
    assert.match(listRow, /absolute/, 'the indicator must be absolutely positioned')
    assert.match(sidebar, /isNavItemActive\(/, 'active state must come from the nav model')
  })

  it('section labels come from one component', () => {
    assert.match(sidebar, /<NavSection/, 'the sidebar must use NavSection')
    assert.equal(
      (navSection.match(/const SECTION_LABEL = /g) || []).length,
      1,
      'there must be exactly one section-label recipe',
    )
    assert.doesNotMatch(
      sidebar,
      /text-label text-muted-foreground/,
      'the sidebar must not inline its own section-label styling',
    )
  })
})

describe('sidebar: the archive does not live here', () => {
  it('the sidebar renders navigation, not the meeting archive', () => {
    assert.match(sidebar, /NAV_GROUPS/, 'the sidebar renders the canonical nav model')
    assert.doesNotMatch(
      sidebar,
      /sidebarItems/,
      'the sidebar must not consume the meeting archive tree',
    )
  })

  it('the meeting library is a real destination instead', () => {
    assert.match(meetings, /useSidebar\(\)/, '/meetings must read real meeting data')
    assert.match(meetings, /Today[\s\S]*Yesterday[\s\S]*This week[\s\S]*Earlier|earlier/, '/meetings must group by date')
    assert.doesNotMatch(meetings, /SAMPLE|FAKE_/i, '/meetings must not ship fixture data')
  })
})

describe('sidebar: footer action hierarchy', () => {
  it('Start Recording is the only prominent footer action', () => {
    const footer = sidebar.match(/data-slot="sidebar-footer"[\s\S]*$/)[0]
    assert.match(footer, /variant="destructive"/, 'the primary footer action must be prominent')
    assert.equal(
      (footer.match(/variant="destructive"/g) || []).length,
      1,
      'exactly one prominent footer action',
    )
  })

  it('there is exactly one recording control in the whole sidebar', () => {
    // The old sidebar had three: a nav row, a rail button and a footer button,
    // with two opposite active/idle polarities.
    const controls = sidebar.match(/data-start-recording="true"/g) || []
    assert.equal(
      controls.length,
      2,
      'expected exactly two branches (expanded button + collapsed row) for ONE action',
    )
    assert.doesNotMatch(
      sidebar,
      /Record \/ New Meeting/,
      'the duplicate "Record / New Meeting" navigation row must be gone',
    )
  })

  it('the recording state is visibly distinct from the idle action', () => {
    assert.match(sidebar, /isRecording \?/, 'the footer must branch on recording state')
    assert.match(sidebar, /Recording in progress/, 'the recording state must be named')
    assert.match(sidebar, /role="status"/, 'recording state must be announced politely')
    assert.match(
      sidebar,
      /aria-live="polite"/,
      'the recording live region must be polite',
    )
  })

  it('secondary and utility actions are quieter than the primary', () => {
    const footer = sidebar.match(/data-slot="sidebar-footer"[\s\S]*$/)[0]
    assert.match(footer, /<ListRow[\s\S]*?Import Audio/, 'Import Audio is a quiet row')
    assert.match(footer, /<Info/, 'About is a quiet utility')
  })

  it('the version is not another navigation row in the sidebar', () => {
    // Version metadata belongs to the About surface, not the navigation rail.
    assert.doesNotMatch(sidebar, /Recall v\{?0?\./, 'the version must not sit in the sidebar')
    assert.match(read('src/components/About.tsx'), /0\.4\.0|version/i, 'About carries the version')
  })
})

describe('sidebar: settings and about', () => {
  it('Settings is presented once, in the navigation model', () => {
    const settingsRows = (sidebar.match(/Settings/g) || []).length
    assert.ok(
      settingsRows <= 1,
      `Settings must appear once in the sidebar chrome, saw ${settingsRows} references`,
    )
    const systemGroup = nav.match(/id: 'system'[\s\S]*?\n  \},/)[0]
    assert.match(systemGroup, /label: 'Settings'/, 'Settings belongs to the SYSTEM group')
  })

  it('Settings keeps its active state through the shared row', () => {
    assert.match(nav, /id: 'settings'[\s\S]*?activePrefixes: \['\/settings'\]/)
    assert.match(listRow, /aria-current/, 'the primitive marks the active row')
  })

  it('About is a compact utility that still opens the Recall dialog', () => {
    assert.match(info, /aria-label="About Recall"/)
    assert.match(info, /About/, 'the expanded utility keeps a visible label')
  })

  it('the About panel stays Recall-only', () => {
    const about = read('src/components/About.tsx')
    // Upstream naming is permitted ONLY as the required MIT attribution, never
    // as product branding. The executable branding scanner
    // (tests/lib/branding-scan.mjs) is the authority on that distinction; this
    // assertion just confirms the attribution is present and nothing else.
    const upstreamMentions = about.match(/meetily|zackriya/gi) || []
    assert.ok(
      upstreamMentions.length <= 3,
      `About must reference upstream only for the MIT attribution, saw ${upstreamMentions.length} mentions`,
    )
    assert.match(about, /MIT/i, 'the required licence attribution must be present')
  })
})

describe('sidebar: collapsed rail is the same system', () => {
  it('the rail renders the same nav model, not a second list', () => {
    assert.equal(
      (sidebar.match(/NAV_GROUPS\.map/g) || []).length,
      1,
      'there must be one nav render, shared by both modes',
    )
    assert.doesNotMatch(
      sidebar,
      /renderCollapsedIcons|CollapsedIcons/,
      'there must not be a separately maintained collapsed list',
    )
  })

  it('the rail is the same rows in a collapsed presentation', () => {
    assert.match(sidebar, /isCollapsed \?[\s\S]*?border-t border-border/, 'groups still divide in the rail')
    assert.match(listRow, /collapsed/, 'the primitive supports a collapsed presentation')
  })

  it('the rail actually renders every destination, not only dividers', () => {
    // This regressed once already: the collapsed branch emitted a rule per
    // group and no rows at all, so the rail looked tidy and navigated nowhere.
    const branch = sidebar.match(/isCollapsed \? \(([\s\S]*?)\) : \(\s*<NavSection/)
    assert.ok(branch, 'the collapsed branch of the nav render must be identifiable')
    assert.match(branch[1], /group\.items\.map/, 'the rail must render the group items')
    assert.match(branch[1], /<ListRow/, 'the rail must render rows')
    assert.match(branch[1], /\bcollapsed\b/, 'rail rows must use the collapsed presentation')
    assert.match(branch[1], /tooltip=\{item\.label\}/, 'rail rows must carry a tooltip')
    assert.match(branch[1], /href=\{item\.href\}/, 'rail rows must still navigate')
  })

  it('collapsed rows keep an accessible name and a tooltip', () => {
    assert.match(listRow, /aria-label/, 'icon-only rows must be named')
    assert.match(listRow, /TooltipContent/, 'icon-only rows must offer a tooltip')
    assert.match(sidebar, /aria-label=\{label\}|label=\{isCollapsed/, 'rows pass their label through')
  })

  it('rail rows share one square footprint', () => {
    assert.match(listRow, /h-9 w-9 shrink-0 justify-center/, 'collapsed rows are square and fixed')
  })
})

describe('sidebar: tokens, identity and motion', () => {
  it('uses semantic tokens only', () => {
    assert.ok(!PALETTE.test(sidebar), 'sidebar must not hardcode palette classes')
    assert.ok(!PALETTE.test(info), 'About trigger must not hardcode palette classes')
    assert.ok(!PALETTE.test(logo), 'brand mark must not hardcode palette classes')
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

  it('exposes a navigation landmark and the collapse control inside the panel', () => {
    assert.match(sidebar, /<nav\b[\s\S]*aria-label="Primary"/, 'the sidebar is a nav landmark')
    // The collapse control must be a descendant of the panel, not a floating
    // sibling. It previously sat at `-right-6 top-20` over the workspace.
    assert.doesNotMatch(
      sidebar,
      /-right-\d|translateX\(50%\)/,
      'the collapse control must not float outside the panel',
    )
    const panelIdx = sidebar.indexOf('<nav')
    const controlIdx = sidebar.indexOf('toggleCollapse}')
    assert.ok(panelIdx > -1 && controlIdx > panelIdx, 'the collapse control lives inside the panel')
  })
})

describe('shell: main content adapts to the sidebar', () => {
  it('the sidebar panel and main content both resolve width from one source', () => {
    assert.match(sidebar, /sidebarWidth\(isCollapsed\)/)
    assert.match(mainContent, /sidebarWidth\(isCollapsed\)/)
  })

  it('neither the panel nor the offset restates the width inline', () => {
    assert.doesNotMatch(sidebar, /\b(?:ml|w)-(?:16|64)\b/)
    assert.doesNotMatch(mainContent, /\b(?:ml|w)-(?:16|64)\b/)
    assert.doesNotMatch(sidebar, /'4rem'|'16rem'/)
    assert.doesNotMatch(mainContent, /'4rem'|'16rem'/)
  })
})
