/**
 * Phase A1 — navigation foundation gate.
 *
 * A1 is structural only. It establishes the contracts A2 will consume:
 * one navigation model, one route source, one sidebar-width source, one
 * list-row primitive, one section-label primitive.
 *
 * This gate deliberately does NOT assert the A2 outcomes. The sidebar archive,
 * the floating collapse control, the duplicate "Record / New Meeting" row and
 * the current footer all still exist on purpose, and A2 changes them. Asserting
 * either side here would freeze an architecture that is about to change, so
 * those contracts stay in `sidebar-polish.test.mjs` until A2 moves them.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

const NAV = 'src/lib/nav.ts'
const ROUTES = 'src/lib/routes.ts'
const LAYOUT = 'src/lib/sidebar-layout.ts'
const GLOBALS = 'src/app/globals.css'
const LIST_ROW = 'src/components/ui/list-row.tsx'
const NAV_SECTION = 'src/components/ui/nav-section.tsx'
const PROVIDER = 'src/components/Sidebar/SidebarProvider.tsx'
const SIDEBAR = 'src/components/Sidebar/index.tsx'

describe('a1: canonical navigation model', () => {
  it('nav.ts exists and is the only navigation model', () => {
    assert.ok(existsSync(NAV), 'lib/nav.ts must exist')

    // Any second file that declares a competing sidebar navigation list.
    const offenders = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue
          walk(rel)
        } else if (/\.(ts|tsx)$/.test(entry.name) && rel !== NAV) {
          const src = readFileSync(join(process.cwd(), rel), 'utf8')
          if (/NAV_GROUPS|NAV_ITEMS\b/.test(src)) offenders.push(rel)
        }
      }
    }
    walk('src')
    assert.deepEqual(offenders, [], `competing navigation models: ${offenders.join(', ')}`)
  })

  it('contains no JSX', () => {
    const src = read(NAV)
    assert.doesNotMatch(src, /<[A-Za-z][^>]*>[\s\S]*<\/[A-Za-z]/, 'nav.ts must not contain JSX')
    assert.doesNotMatch(src, /\breturn\s*\(/, 'nav.ts must not render anything')
    assert.doesNotMatch(src, /className=/, 'nav.ts must not carry styling')
  })

  it('declares the three navigation groups in order', () => {
    const src = read(NAV)
    const groups = [...src.matchAll(/id: '(primary|knowledge|system)'/g)].map((m) => m[1])
    assert.deepEqual(groups, ['primary', 'knowledge', 'system'])
  })

  /**
   * Structural view of one group. A destination is an object that has BOTH a
   * label and a `routes.*` href; the group's own heading has only a label, so
   * pairing on the object's own `id:`/`label:` keeps the two apart.
   */
  const groupBlock = (groupId) => {
    const src = read(NAV)
    const order = ['primary', 'knowledge', 'system']
    const marker = (id) => `id: '${id}',`
    const start = src.indexOf(marker(groupId))
    assert.notEqual(start, -1, `nav.ts must declare the '${groupId}' group`)
    const from = src.slice(start + marker(groupId).length)
    const later = order
      .slice(order.indexOf(groupId) + 1)
      .map((id) => from.indexOf(marker(id)))
      .filter((i) => i > 0)
    return later.length ? from.slice(0, Math.min(...later)) : from
  }

  const itemLabels = (groupId) => {
    const block = groupBlock(groupId)
    const pairs = [...block.matchAll(/id: '(\w+)',\s*label: '([^']+)',/g)]
    const labels = []
    pairs.forEach((m, i) => {
      const end = i + 1 < pairs.length ? pairs[i + 1].index : block.length
      if (/href:\s*routes\.\w+\(/.test(block.slice(m.index, end))) labels.push(m[2])
    })
    return labels
  }

  it('primary group is Home, Meetings, Calendar, Daily', () => {
    assert.deepEqual(itemLabels('primary'), ['Home', 'Meetings', 'Calendar', 'Daily'])
  })

  it('knowledge group is Contexts, Templates, Meeting Notes', () => {
    assert.deepEqual(itemLabels('knowledge'), ['Contexts', 'Templates', 'Meeting Notes'])
  })

  it('system group is Settings only', () => {
    assert.deepEqual(itemLabels('system'), ['Settings'])
  })

  it('every group has a human heading', () => {
    for (const [id, heading] of [
      ['primary', 'Meetings'],
      ['knowledge', 'Knowledge'],
      ['system', 'System'],
    ]) {
      assert.match(
        read(NAV),
        new RegExp(`id: '${id}',\\s*label: '${heading}'`),
        `the ${id} group must be headed "${heading}"`,
      )
    }
  })

  it('actions and utility surfaces are not navigation destinations', () => {
    const src = read(NAV)
    const items = src.slice(src.indexOf('export const NAV_GROUPS'))
    for (const forbidden of [
      'Record / New Meeting',
      'Start Recording',
      'Import Audio',
      'About',
    ]) {
      assert.ok(
        !items.includes(`label: '${forbidden}'`),
        `${forbidden} is an action or utility, not a navigation destination`,
      )
    }
  })

  it('every destination resolves through the route helpers', () => {
    const src = read(NAV)
    const hrefs = [...src.matchAll(/href:\s*routes\.(\w+)\(/g)].map((m) => m[1])
    assert.equal(hrefs.length, 8, 'all 8 destinations must use a routes.* helper')
    assert.ok(!/href:\s*'/.test(src), 'no navigation href may be a raw route string')

    // Every helper referenced by the model must actually exist in routes.ts.
    const routesSrc = read(ROUTES)
    for (const helper of new Set(hrefs)) {
      assert.ok(
        new RegExp(`\\b${helper}\\s*:`).test(routesSrc),
        `routes.${helper}() is referenced by the nav model but not defined`,
      )
    }
  })
})

describe('a1: route integrity', () => {
  it('routes.ts defines a helper for every navigation destination', () => {
    const routesSrc = read(ROUTES)
    for (const helper of [
      'home',
      'meetings',
      'calendar',
      'daily',
      'contexts',
      'templates',
      'notes',
      'settings',
    ]) {
      assert.ok(
        new RegExp(`\\b${helper}\\s*:`).test(routesSrc),
        `routes.${helper}() must be defined`,
      )
    }
  })

  it('the notes route is callable without an id, for the navigation destination', () => {
    const routesSrc = read(ROUTES)
    assert.match(
      routesSrc,
      /notes:\s*\(noteId\?/,
      'routes.notes() must accept an optional id so navigation can link to bare /notes',
    )
  })

  it('every navigation destination maps to a real app route', () => {
    // Intent, stated once: helper -> the path it must resolve to.
    const expected = {
      home: '/',
      meetings: '/meetings',
      calendar: '/calendar',
      daily: '/daily',
      contexts: '/context',
      templates: '/templates',
      notes: '/notes',
      settings: '/settings',
    }
    const routesSrc = read(ROUTES)
    const navSrc = read(NAV)
    const used = [...navSrc.matchAll(/href:\s*routes\.(\w+)\(/g)].map((m) => m[1])

    for (const helper of used) {
      const path = expected[helper]
      assert.ok(path, `navigation uses routes.${helper}(), which has no expected path`)
      assert.ok(
        routesSrc.includes(`'${path}'`),
        `routes.${helper}() must resolve to '${path}'`,
      )

      const routeFile = path === '/' ? 'src/app/page.tsx' : `src/app${path}/page.tsx`
      // /meetings is the one destination whose screen A2 builds. A1 adds the
      // route and the nav entry; it must not add a placeholder screen.
      if (path === '/meetings') {
        assert.ok(
          !existsSync(routeFile),
          '/meetings must not have a placeholder screen in A1 — A2 implements it',
        )
        continue
      }
      assert.ok(existsSync(routeFile), `navigation destination ${path} has no page at ${routeFile}`)
    }
  })
})

describe('a1: list-row primitive', () => {
  it('exists', () => {
    assert.ok(existsSync(LIST_ROW), 'ui/list-row.tsx must exist')
  })

  it('uses semantic tokens only, with no raw palette', () => {
    const src = read(LIST_ROW)
    assert.doesNotMatch(
      src,
      /\b(?:bg|text|border|ring)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
      'list-row must not hardcode raw palette colours',
    )
    assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i, 'list-row must not hardcode hex colours')
    assert.doesNotMatch(src, /rgba?\(/, 'list-row must not hardcode rgb()')
  })

  it('does not use the lime accent as a generic hover', () => {
    const src = read(LIST_ROW)
    assert.doesNotMatch(src, /hover:bg-accent\b/, 'hover must use the neutral muted surface')
  })

  it('supports the required states', () => {
    const src = read(LIST_ROW)
    for (const prop of ['active', 'disabled', 'collapsed', 'icon', 'label', 'badge', 'trailing']) {
      assert.ok(new RegExp(`\\b${prop}[?]?:`).test(src), `ListRow must support "${prop}"`)
    }
    assert.ok(/hover:bg-muted/.test(src), 'idle/hover must use bg-muted')
    assert.ok(/focus-visible:ring-ring/.test(src), 'focus must use the ring token')
    assert.ok(
      /ring-offset-background/.test(src),
      'focus ring must set the offset colour so it is correct in dark mode',
    )
  })

  it('exposes current and disabled semantics, and cannot be a link when disabled', () => {
    const src = read(LIST_ROW)
    assert.match(src, /aria-current/, 'active rows must expose aria-current')
    assert.match(src, /aria-disabled/, 'disabled rows must expose aria-disabled')
    assert.match(src, /href=\{disabled \? undefined : href\}/, 'a disabled row must drop its href')
  })

  it('the active indicator is absolutely positioned so selection cannot shift layout', () => {
    const src = read(LIST_ROW)
    assert.match(src, /absolute/, 'the active indicator must be absolutely positioned')
  })

  it('renders the correct semantic element and names icon-only rows', () => {
    const src = read(LIST_ROW)
    assert.match(src, /as === 'a'/, 'must support rendering an anchor')
    // The accessible name is supplied as a prop, not as JSX, so match the
    // object-literal form the component actually uses.
    assert.match(
      src,
      /['"]aria-label['"]:\s*collapsed \? label : undefined/,
      'collapsed rows must receive the label as their accessible name',
    )
    assert.match(src, /TooltipContent/, 'collapsed rows must expose a tooltip')
  })
})

describe('a1: nav-section primitive', () => {
  it('exists', () => {
    assert.ok(existsSync(NAV_SECTION), 'ui/nav-section.tsx must exist')
  })

  it('uses semantic tokens and exactly one label recipe', () => {
    const src = read(NAV_SECTION)
    assert.doesNotMatch(
      src,
      /\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|stone|red|blue|green|yellow|lime)-\d{2,3}\b/,
      'nav-section must not hardcode raw palette colours',
    )

    // The recipe is the exported constant; comments may mention the token name
    // without creating a second definition.
    const recipe = src.match(/const SECTION_LABEL = '([^']*)'/)
    assert.ok(recipe, 'nav-section must define the canonical section-label recipe')
    assert.match(recipe[1], /\btext-label\b/, 'the label must use the semantic text-label token')
    assert.match(
      recipe[1],
      /\btext-muted-foreground\b/,
      'the label must use the muted ink token',
    )
    assert.match(recipe[1], /\bpx-3\b/, 'the label must align with the rows it heads')

    // Nothing else in the file may re-declare a competing label style.
    const declarations = src.match(/const\s+SECTION_LABEL/g) || []
    assert.equal(declarations.length, 1, 'nav-section must declare the label exactly once')
  })

  it('provides accessible grouping', () => {
    const src = read(NAV_SECTION)
    assert.match(src, /role="group"/, 'a section must expose group semantics')
    assert.match(src, /aria-label=\{label\}/, 'a group must be named by its label')
  })
})

describe('a1: sidebar layout has one source of truth', () => {
  it('the width variables exist exactly once, in globals.css', () => {
    const globals = read(GLOBALS)
    for (const v of ['--recall-sidebar-width-expanded', '--recall-sidebar-width-collapsed']) {
      const inGlobals = (globals.match(new RegExp(`${v}\\s*:`, 'g')) || []).length
      assert.equal(inGlobals, 1, `${v} must be declared exactly once`)
    }
  })

  it('lib/sidebar-layout.ts is the only place that reads those variables', () => {
    const layout = read(LAYOUT)
    for (const v of ['--recall-sidebar-width-expanded', '--recall-sidebar-width-collapsed']) {
      assert.ok(layout.includes(v), `sidebar-layout must reference ${v}`)
    }
    assert.match(layout, /export function sidebarWidth\(isCollapsed: boolean\)/)

    // No component may hardcode the variables or the rem equivalents.
    const offenders = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (['node_modules', '.next'].includes(entry.name)) continue
          walk(rel)
        } else if (/\.(ts|tsx)$/.test(entry.name) && rel !== LAYOUT) {
          const src = readFileSync(join(process.cwd(), rel), 'utf8')
          if (/--recall-sidebar-width-|isCollapsed \? '4rem' : '16rem'/.test(src)) {
            offenders.push(rel)
          }
        }
      }
    }
    walk('src')
    assert.deepEqual(offenders, [], `sidebar width restated in: ${offenders.join(', ')}`)
  })

  it('every layout consumer resolves its width through sidebarWidth()', () => {
    for (const consumer of [
      'src/components/MainContent/index.tsx',
      'src/app/_components/StatusOverlays.tsx',
      SIDEBAR,
    ]) {
      const src = read(consumer)
      assert.match(
        src,
        /sidebarWidth\(/,
        `${consumer} must resolve its width via sidebarWidth()`,
      )
    }
    assert.match(read('src/app/page.tsx'), /sidebarWidth\(/, 'app/page.tsx must use sidebarWidth()')
  })

  it('no layout consumer keeps a duplicated w-*/ml-* sidebar width', () => {
    for (const consumer of [
      'src/components/MainContent/index.tsx',
      'src/app/_components/StatusOverlays.tsx',
      'src/app/page.tsx',
      SIDEBAR,
    ]) {
      const src = read(consumer)
      assert.doesNotMatch(
        src,
        /\b(?:ml|w)-(?:16|64)\b/,
        `${consumer} must not restate the sidebar width as a width utility`,
      )
      assert.doesNotMatch(
        src,
        /'4rem'|'16rem'|"4rem"|"16rem"/,
        `${consumer} must not restate the sidebar width as a rem literal`,
      )
    }
  })
})

describe('a1: sidebar state', () => {
  it('launches expanded', () => {
    const src = read(PROVIDER)
    assert.match(
      src,
      /const \[isCollapsed, setIsCollapsed\] = useState\(false\)/,
      'Recall must launch with the sidebar expanded',
    )
  })

  it('still supports both states and a toggle', () => {
    const src = read(PROVIDER)
    assert.match(src, /toggleCollapse/, 'the collapse toggle must survive A1')
    assert.match(
      src,
      /setIsCollapsed\(prev => !prev\)/,
      'the toggle must flip, not force, the state',
    )
  })
})
