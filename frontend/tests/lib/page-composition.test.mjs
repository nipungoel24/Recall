import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase C - page composition.
 *
 * Phase B gave the shell ownership of the viewport and of page scrolling. It
 * deliberately left one thing unresolved and documented it: Home and Settings
 * each declared their own `px-8` on top of the shell's `px-8 py-6`, so those
 * screens were inset 56-64px while Meetings was inset 32px. Phase C picks ONE
 * model and these tests hold it in place:
 *
 *   the shell owns the gutter; a page owns only its measure (max-width).
 *
 * A page that re-declares horizontal padding, or centres itself with mx-auto,
 * breaks the shared left edge that makes the app read as one product.
 *
 * The assertions are structural (does this file declare page padding?) rather
 * than pixel assertions, so a legitimate refactor can change class names.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SHELL = 'src/components/MainContent/index.tsx';
const HEADER = 'src/components/shared/PageHeader.tsx';

const PAGES = [
  'src/app/meetings/page.tsx',
  'src/app/notes/page.tsx',
  'src/components/Home/HomeDashboard.tsx',
  'src/app/settings/page.tsx',
];

/**
 * Comments are stripped before scanning. Several of these files *document* the
 * rules they follow ("no local fixture", "must not add a recording action"), and
 * a naive text search would flag that prose as a violation.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The element that carries a page's measure. Phase C's invariant is about this
 * element specifically: it may cap the width, but it must not also re-declare
 * page padding or centre itself.
 */
function pageMeasureClass(src) {
  const code = stripComments(src);
  const m = code.match(/className="([^"]*\bmax-w-[^"]*)"/);
  return m ? m[1] : null;
}

describe('phase C: the shell owns the page gutter', () => {
  it('the shell still declares the single gutter', () => {
    const shell = read(SHELL);
    assert.match(shell, /px-8 py-6/, 'MainContent remains the one place page gutters are declared');
  });

  it('no page re-declares horizontal page padding', () => {
    const offenders = [];
    for (const page of PAGES) {
      const measure = pageMeasureClass(read(page)) ?? '';
      if (/\bpx-\d/.test(measure) || /\bpy-\d/.test(measure)) {
        offenders.push(`${page}: ${measure}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a page's measure wrapper must not add its own gutters on top of the shell: ${offenders.join(' | ')}`,
    );
  });

  it('no page centres itself with mx-auto', () => {
    // A centred page drifts away from the shared left edge as the measure
    // changes, which is exactly the inconsistency Phase C1 set out to remove.
    const offenders = PAGES.filter((page) => {
      const measure = pageMeasureClass(read(page)) ?? '';
      return /\bmx-auto\b/.test(measure);
    });
    assert.deepEqual(
      offenders,
      [],
      `pages must stay left-aligned with the shared gutter: ${offenders.join(', ')}`,
    );
  });
});

describe('phase C: content width matches content type', () => {
  it('every owned page declares a deliberate measure', () => {
    for (const page of PAGES) {
      const measure = pageMeasureClass(read(page));
      assert.ok(
        measure,
        `${page} must declare a content measure instead of running full width`,
      );
    }
  });

  it('the measure is not one universal width for every screen', () => {
    // A reading-adjacent surface, an archive and a dashboard have different
    // natural widths. One identical max-width across all of them means the
    // measure was chosen by habit rather than by content type.
    const measures = PAGES.map((page) => {
      const measure = pageMeasureClass(read(page)) ?? '';
      const m = measure.match(/\b(max-w-[^\s"]+)/);
      return m ? m[1] : null;
    });
    assert.ok(
      new Set(measures).size >= 2,
      `expected differentiated measures across screens, got: ${measures.join(', ')}`,
    );
  });
});

describe('phase C: page header system', () => {
  it('the shared header exposes a metadata slot for counts', () => {
    const header = read(HEADER);
    assert.match(header, /meta\??:/, 'PageHeader must accept compact metadata such as a count');
    assert.match(header, /text-page-title/, 'the page title must use the shared title token');
  });

  it('the header keeps a single h1 and a right-aligned action slot', () => {
    const header = read(HEADER);
    const h1Count = (header.match(/<h1/g) || []).length;
    assert.equal(h1Count, 1, 'PageHeader must render exactly one h1');
    assert.match(header, /actions\??:/, 'PageHeader must expose an actions slot');
  });

  it('empty states can express failure distinctly from emptiness', () => {
    const header = read(HEADER);
    assert.match(header, /tone\??:/, 'EmptyState must distinguish an error from an empty list');
    assert.match(header, /role=\{error \? 'alert'/, 'an error state must be announced');
  });

  it('a loading placeholder exists and is announced', () => {
    const header = read(HEADER);
    assert.match(header, /ListSkeleton/, 'a quiet loading placeholder must exist');
    assert.match(header, /aria-busy|aria-live/, 'the loading state must be announced to assistive tech');
  });
});

describe('phase C: token and motion discipline', () => {
  it('the pages Phase C owns introduce no raw palette classes', () => {
    const raw = /\b(?:bg|text|border|ring|from|to|via)-(?:gray|white|black|slate|zinc|neutral|stone|red|blue|green|amber|yellow|lime|indigo|purple|pink|emerald|cyan|sky|violet|rose|orange|teal|fuchsia)-\d{2,3}\b/;
    for (const page of [...PAGES, HEADER]) {
      assert.doesNotMatch(
        read(page),
        raw,
        `${page} must use semantic tokens, not raw palette classes`,
      );
    }
  });

  it('the pages Phase C owns introduce no transition-all', () => {
    for (const page of [...PAGES, HEADER]) {
      assert.doesNotMatch(read(page), /transition-all/, `${page} must not add transition-all`);
    }
  });
});
