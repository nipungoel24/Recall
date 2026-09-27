import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase B — desktop layout foundation.
 *
 * These tests assert the *contract* that ended the "document is 48px taller
 * than the window" defect, not the exact utility strings used to express it.
 * They are deliberately structural: each one fails if a future change lets a
 * page re-claim the viewport, lets the document grow, or duplicates the
 * canonical sidebar width.
 *
 * Background (measured via CDP on the real Tauri app, 1100x700):
 *   before — documentElement.scrollHeight 748 vs clientHeight 700, and
 *            window.scrollTo(0,400) actually moved the document 48px.
 *   cause  — `html` had no height, so `body { height: 100% }` resolved against
 *            its own content instead of the viewport and clipped nothing; the
 *            shell row had no height; and every page declared its own
 *            `h-screen`, with the shell gutter padding added around it
 *            (700 + 24 + 24 = 748).
 *   after  — documentElement.scrollHeight === clientHeight, the document never
 *            scrolls, and the single page scroller owns vertical overflow.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const exists = (rel) => existsSync(path.join(root, rel));

const LAYOUT = 'src/app/layout.tsx';
const GLOBALS = 'src/app/globals.css';
const MAIN = 'src/components/MainContent/index.tsx';
const SIDEBAR = 'src/components/Sidebar/index.tsx';
const WORKSPACE = 'src/components/MeetingWorkspace/MeetingWorkspace.tsx';

const src = exists;
const get = read;

// Pages that must fill the shell's content box (they own internal scrolling).
const FILL_PAGES = [
  'src/app/page.tsx',
  'src/app/settings/page.tsx',
  'src/app/meeting-details/page.tsx',
  'src/app/meeting-details/page-content.tsx',
];

// Pages that simply flow; the shell's page scroller handles their overflow.
const FLOWING_PAGES = [
  'src/app/meetings/page.tsx',
  'src/app/notes/page.tsx',
  'src/app/daily/page.tsx',
  'src/app/context/page.tsx',
  'src/app/context/context-detail-client.tsx',
  'src/components/Home/HomeDashboard.tsx',
  'src/components/Calendar/index.tsx',
];

// Files that legitimately keep a viewport-height concept.
const VIEWPORT_OWNERS = [SIDEBAR, 'src/components/onboarding/OnboardingContainer.tsx'];

describe('phase B: the shell owns the viewport', () => {
  it('the root element has a definite height', () => {
    const css = get(GLOBALS);
    const htmlBlock = css.match(/^\s*html\s*\{([\s\S]*?)\}/m);
    assert.ok(htmlBlock, 'globals.css must declare an html rule');
    assert.match(
      htmlBlock[1],
      /height:\s*100%/,
      'html needs a definite height, otherwise body{height:100%} resolves against its own content',
    );
  });

  it('the body is an intentional desktop clipping boundary', () => {
    const css = get(GLOBALS);
    const bodyBlock = css.match(/^\s*body\s*\{([\s\S]*?)\}/m);
    assert.ok(bodyBlock, 'globals.css must declare a body rule');
    assert.match(bodyBlock[1], /overflow:\s*hidden/, 'the document itself must never scroll');
    assert.match(bodyBlock[1], /height:\s*100%/, 'the body must fill the viewport');
  });

  it('the shell row is bounded to the viewport', () => {
    const layout = get(LAYOUT);
    // The shell is the flex row that holds the skip link, the sidebar and
    // MainContent. Locate it by its children rather than by adjacency, so an
    // explanatory comment inside it cannot break the assertion.
    const shellIdx = layout.indexOf('<Sidebar />');
    assert.ok(shellIdx > -1, 'the shell must render the sidebar');
    const open = layout.lastIndexOf('<div className="', shellIdx);
    assert.ok(open > -1, 'the shell row must be a div');
    const openTag = layout.slice(open, layout.indexOf('>', open) + 1);
    assert.match(
      openTag,
      /\bflex\b/,
      'the shell must be a flex row',
    );
    assert.match(
      openTag,
      /\bh-dvh\b/,
      'the shell must bound itself to the viewport height (h-dvh), not grow with content',
    );
    assert.match(
      openTag,
      /overflow-hidden/,
      'the shell is the intentional clipping boundary for the application window',
    );
    assert.match(
      layout.slice(shellIdx, shellIdx + 200),
      /<MainContent>/,
      'the shell row must also contain MainContent',
    );
  });
});

describe('phase B: main content geometry', () => {
  it('main is height-bounded and clips, so it cannot grow the document', () => {
    const main = get(MAIN);
    assert.match(main, /min-h-0/, 'main needs min-h-0 to shrink inside the shell flex row');
    assert.match(main, /overflow-hidden/, 'main must clip rather than expand the document');
    assert.match(main, /flex-col/, 'main must be a column so the scroller can take the remainder');
  });

  it('there is exactly one page scroller', () => {
    const main = get(MAIN);
    const scrollers = main.match(/overflow-y-auto/g) || [];
    assert.equal(
      scrollers.length,
      1,
      `MainContent must own exactly one vertical scroller, found ${scrollers.length}`,
    );
    assert.match(main, /data-slot="page-scroll"/, 'the page scroller must be identifiable');
  });

  it('the page gutters are defined in one place only', () => {
    const main = get(MAIN);
    assert.match(
      main,
      /px-8 py-6/,
      'MainContent is the single place page gutters are defined',
    );
  });

  it('main content still clears the sidebar through the canonical width', () => {
    const main = get(MAIN);
    assert.match(main, /sidebarWidth\(isCollapsed\)/, 'the sidebar offset must come from the single source');
    assert.doesNotMatch(
      main,
      /\b(?:ml|w)-(?:16|64)\b|'4rem'|'16rem'/,
      'main content must not restate the sidebar width inline',
    );
  });
});

describe('phase B: pages do not claim the viewport', () => {
  it('no page root declares its own viewport height', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'ui') continue;
          walk(full);
        } else if (entry.name.endsWith('.tsx')) {
          const body = readFileSync(full, 'utf8');
          // `max-h-screen` is a ceiling on a centred dialog, not a claim to own
          // the viewport, so it is deliberately excluded.
          if (/(?<!max-)\bh-screen\b/.test(body)) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, 'src'));
    const allowed = offenders.filter((f) => VIEWPORT_OWNERS.includes(f.replace(/\\/g, '/')));
    assert.deepEqual(
      allowed,
      [],
      `only the fixed sidebar and the standalone onboarding flow may use h-screen; found: ${allowed.join(', ')}`,
    );
  });

  it('pages that fill the shell use h-full, not h-screen', () => {
    for (const page of FILL_PAGES) {
      assert.ok(src(page), `${page} must exist`);
      assert.match(get(page), /\bh-full\b/, `${page} must fill the shell with h-full`);
      assert.doesNotMatch(get(page), /\bh-screen\b/, `${page} must not claim the viewport`);
    }
  });

  it('flowing pages do not install their own vertical scroller', () => {
    for (const page of FLOWING_PAGES) {
      assert.ok(src(page), `${page} must exist`);
      const body = get(page);
      assert.doesNotMatch(
        body,
        /overflow-y-auto/,
        `${page} must let the shell's page scroller own vertical overflow`,
      );
      assert.doesNotMatch(body, /\bh-screen\b/, `${page} must not claim the viewport`);
    }
  });
});

describe('phase B: the sidebar is independent of main content', () => {
  it('the sidebar is fixed and full height, so it needs no flow slot', () => {
    const sidebar = get(SIDEBAR);
    const root0 = sidebar.match(/<div\s+className="fixed[^"]*"/);
    assert.ok(root0, 'the sidebar panel must be identifiable');
    assert.match(root0[0], /fixed/, 'the sidebar must be position:fixed');
    assert.match(root0[0], /h-dvh/, 'the sidebar must be viewport height');
  });

  it('the sidebar keeps its own single scroll region', () => {
    const sidebar = get(SIDEBAR);
    const scrollers = sidebar.match(/overflow-y-auto/g) || [];
    assert.equal(scrollers.length, 1, 'the sidebar must keep exactly one vertical scroller');
  });
});

describe('phase B: workspace tab strip stays usable', () => {
  it('the tab strip may shrink and scroll instead of clipping its last tab', () => {
    const ws = get(WORKSPACE);
    const tabsList = ws.match(/<TabsList[\s\S]*?\/>/);
    assert.ok(tabsList, 'the workspace TabsList must be identifiable');
    assert.doesNotMatch(
      tabsList[0],
      /flex-shrink-0/,
      'a non-shrinking tab strip pushed the last tab out of the window at narrow widths',
    );
    assert.match(tabsList[0], /overflow-x-auto/, 'the tab strip must scroll rather than hide tabs');
  });

  it('all six workspace sections remain declared', () => {
    const ws = get(WORKSPACE);
    for (const section of ['overview', 'summary', 'transcript', 'tasks', 'notes', 'context']) {
      assert.match(ws, new RegExp(`value="${section}"`), `workspace must keep the ${section} tab`);
    }
  });
});

describe('phase B: the window has a minimum size', () => {
  it('the window declares a minimum width and height', () => {
    const conf = JSON.parse(get('src-tauri/tauri.conf.json'));
    const win = conf.app.windows[0];
    assert.ok(win.minWidth, 'the window needs minWidth so the shell is never sized below its design minimum');
    assert.ok(win.minHeight, 'the window needs minHeight');
    assert.ok(
      win.minWidth <= win.width,
      'minWidth must not exceed the default width',
    );
    assert.ok(win.minHeight <= win.height, 'minHeight must not exceed the default height');
  });
});

describe('phase B: no lime accent used as a generic hover', () => {
  it('no component uses hover:bg-accent', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.(tsx|ts)$/.test(entry.name)) {
          if (/hover:bg-accent/.test(readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(path.join(root, 'src'));
    assert.deepEqual(offenders, [], `lime accent must not be a generic hover: ${offenders.join(', ')}`);
  });
});
