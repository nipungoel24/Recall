// Gate 8 — Polish regression guard.
//
// Locks in the accessibility, semantic-token, motion and state guarantees that
// Gate 8 introduced, so later work cannot silently regress them. These are
// static source assertions, consistent with the other frontend/lib suites.
//
// Scope note: this file asserts on Gate 8's *polish* contract only. It must
// never be used to pin Phase 5 intelligence behaviour — that is owned by
// phase5-context-deepening.test.mjs.

import { it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd())
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|accent|decoration)-(?:gray|white|black|blue|red|green|amber|yellow|indigo|purple|pink|emerald|cyan|sky|violet|rose|orange|teal|lime|fuchsia|slate|zinc|neutral|stone)(?:-[0-9]{2,3})?\b/

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Every file Gate 8 touched that carries user-visible styling. */
const STYLED_FILES = [
  'src/app/_components/SettingsModal.tsx',
  'src/app/layout.tsx',
  'src/components/About.tsx',
  'src/components/AudioBackendSelector.tsx',
  'src/components/BetaSettings.tsx',
  'src/components/Calendar/index.tsx',
  'src/components/ComplianceNotification.tsx',
  'src/components/ConfirmationModel/confirmation-modal.tsx',
  'src/components/Context/AddToContextButton.tsx',
  'src/components/Context/ContextTimeline.tsx',
  'src/components/DailyMeeting/DailyBriefSection.tsx',
  'src/components/DailyMeeting/MeetingCard.tsx',
  'src/components/ImportAudio/ImportAudioDialog.tsx',
  'src/components/Info.tsx',
  'src/components/LanguagePickerPopover.tsx',
  'src/components/Logo.tsx',
  'src/components/MainContent/index.tsx',
  'src/components/MeetingWorkspace/ContextTab.tsx',
  'src/components/MeetingWorkspace/MeetingWorkspace.tsx',
  'src/components/MeetingWorkspace/NotesTab.tsx',
  'src/components/MeetingWorkspace/OverviewTab.tsx',
  'src/components/MeetingWorkspace/TasksTab.tsx',
  'src/components/ModelSettingsModal.tsx',
  'src/components/ParakeetModelManager.tsx',
  'src/components/RecordingSettings.tsx',
  'src/components/RecordingStatusBar.tsx',
  'src/components/Sidebar/index.tsx',
  'src/components/SummaryModelSettings.tsx',
  'src/components/TranscriptSettings.tsx',
  'src/components/VirtualizedTranscriptView.tsx',
  'src/components/WhisperModelManager.tsx',
  'src/components/onboarding/OnboardingContainer.tsx',
  'src/components/onboarding/shared/ProgressIndicator.tsx',
  'src/components/templates/SummaryTemplateManager.tsx',
  'src/components/templates/TemplateEditor.tsx',
]

describe('Gate 8: semantic design tokens', () => {
  for (const rel of STYLED_FILES) {
    it(`${rel} has zero hardcoded palette classes`, () => {
      const src = stripComments(read(rel))
      const bad = src
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => PALETTE.test(line))
      assert.deepEqual(
        bad,
        [],
        `${rel} must use semantic tokens only. Offending lines:\n` +
          bad.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')
      )
    })
  }

  it('no Gate 8 file emits an invalid double-opacity class', () => {
    for (const rel of STYLED_FILES) {
      const src = stripComments(read(rel))
      assert.ok(
        !/\/[0-9]+\/[0-9]+/.test(src),
        `${rel} contains a malformed opacity modifier such as primary/5/60`
      )
    }
  })

  it('no Gate 8 file leaves a no-op hover (hover state identical to rest)', () => {
    // Two shapes to catch:
    //   "text-primary hover:text-primary"
    //   "bg-surface hover:bg-surface"
    // Bare width utilities (border/ring/shadow) are deliberately not matched:
    // `border hover:border` sets width then colour and is legitimate.

    for (const rel of STYLED_FILES) {
      const src = stripComments(read(rel))

      const variant = src.match(/\b([a-z-]+:[a-z-]+)\s+hover:\1\b(?![\w/-])/g)
      assert.ok(!variant, `${rel} has a no-op hover: ${variant ? variant[0] : ''}`)

      const bare = src.match(
        /\b(bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?!hover|focus|active|group|peer|dark|sm|md|lg|xl|\d)([a-z][a-z-]*)\s+hover:\1-\2\b(?![\w/-])/g
      )
      assert.ok(!bare, `${rel} has a no-op hover: ${bare ? bare[0] : ''}`)
    }
  })
})

describe('Gate 8: dialogs are real dialogs', () => {
  it('SettingsModal builds every modal on the shared Radix Dialog', () => {
    const src = read('src/app/_components/SettingsModal.tsx')
    // Quote-agnostic: this file uses double quotes, most of the app uses single.
    assert.ok(
      /from\s+["']@\/components\/ui\/dialog["']/.test(src),
      'must import Dialog primitives'
    )

    // Six modals, each a controlled <Dialog open={...} onOpenChange={...}>.
    const dialogs = src.match(/<Dialog\s+open=\{modals\./g) || []
    assert.equal(dialogs.length, 6, 'all six modals must be Radix Dialog roots')

    for (const name of [
      'modelSettings',
      'deviceSettings',
      'languageSettings',
      'modelSelector',
      'errorAlert',
      'chunkDropWarning',
    ]) {
      assert.ok(
        src.includes(`onClose("${name}")`) || src.includes(`onClose('${name}')`),
        `${name} must close via the onClose callback`
      )
    }
  })

  it('SettingsModal no longer hand-rolls modal scrims or close buttons', () => {
    const src = read('src/app/_components/SettingsModal.tsx')
    assert.ok(!src.includes('bg-opacity-50'), 'must not hand-roll scrims')
    assert.ok(!src.includes('<svg'), 'must not inline svg icons; use Lucide')
    // Every modal needs a DialogTitle so the dialog has an accessible name.
    const titles = src.match(/<DialogTitle/g) || []
    assert.equal(titles.length, 6, 'every modal needs a DialogTitle')
  })

  it('SettingsModal exposes selectable Ollama models as real buttons', () => {
    const src = read('src/app/_components/SettingsModal.tsx')
    assert.ok(src.includes('aria-pressed={isSelected}'), 'model choice must expose pressed state')
    assert.ok(
      /<button[\s\S]{0,600}aria-pressed=\{isSelected\}/.test(src),
      'the selectable model card must be a real <button>, not a div'
    )
  })

  it('confirmation modal is an alertdialog with a real focus trap', () => {
    const src = read('src/components/ConfirmationModel/confirmation-modal.tsx')
    assert.ok(src.includes("from '@/components/ui/dialog'"), 'must use the Dialog primitive')
    assert.ok(src.includes('DialogTitle'), 'must have a titled dialog')
    assert.ok(src.includes('AlertTriangle'), 'destructive action must carry a warning icon')
  })
})

describe('Gate 8: keyboard and screen-reader access', () => {
  it('shell provides a skip link targeting the main landmark', () => {
    const layout = read('src/app/layout.tsx')
    const main = read('src/components/MainContent/index.tsx')
    assert.ok(/href="#main-content"/.test(layout), 'layout must expose a skip link')
    assert.ok(/id="main-content"/.test(main), 'main content must expose the skip target')
    assert.ok(/tabIndex={-1}/.test(main), 'skip target must be programmatically focusable')
  })

it('sidebar rows are real buttons, not clickable divs', () => {
    const src = stripComments(read('src/components/Sidebar/index.tsx'))
    assert.ok(!/<div[^>]*onClick=\{\(\) => (handleSelect|setActiveMeeting|toggle)/.test(src),
    'navigable rows must not be div onClick')
    assert.ok(src.includes('aria-expanded'), 'the collapse control must expose expansion state')
    /*
     * A2 moved row semantics into the shared ListRow primitive. The guarantee
     * is unchanged — the active destination is still marked for assistive
     * technology — but it is now produced by the primitive from the `active`
     * prop the sidebar derives from the canonical nav model. Both halves are
     * asserted so the chain cannot silently break.
     */
    assert.ok(src.includes('isNavItemActive('), 'the sidebar must derive active state from the nav model')
    const listRow = stripComments(read('src/components/ui/list-row.tsx'))
    assert.ok(listRow.includes('aria-current'), 'ListRow must mark the active row with aria-current')
  })

  it('recording status announces transitions without spamming the timer', () => {
    const src = read('src/components/RecordingStatusBar.tsx')
    assert.ok(src.includes('role="status"'), 'state changes need a polite live region')
    assert.ok(src.includes('role="timer"'), 'elapsed clock must be a queryable timer')
    assert.ok(src.includes('aria-label'), 'the timer must have a spoken label')
    // The visible text ticks once per second, so it must be hidden from AT.
    // Match the span that actually renders the clock, not the status dot.
    assert.ok(
      /<span\s+className=\{`text-sm[^`]*`\}\s+aria-hidden="true"\s*>\s*\{isPaused \? 'Paused' : 'REC'\}/.test(src),
      'the per-second visible REC/clock text must be aria-hidden'
    )
  })

  it('icon-only controls carry accessible names', () => {
    for (const rel of [
      'src/components/Logo.tsx',
      'src/components/Info.tsx',
      'src/components/ModelSettingsModal.tsx',
      'src/components/TranscriptSettings.tsx',
      'src/components/ComplianceNotification.tsx',
    ]) {
      const src = read(rel)
      assert.ok(
        /aria-label=|sr-only/.test(src),
        `${rel} exposes an icon-only control with no accessible name`
      )
    }
  })

  it('MeetingWorkspace exposes a single Tabs root', () => {
    const src = read('src/components/MeetingWorkspace/MeetingWorkspace.tsx')
    const roots = src.match(/<Tabs\s+value=/g) || []
    assert.equal(roots.length, 1, 'MeetingWorkspace must have exactly one Tabs root')
    assert.ok(src.includes('sr-only'), 'the workspace needs a programmatic h1')
  })
})

describe('Gate 8: loading, empty and error states are truthful', () => {
  it('NotesTab renders a real empty state and never parses JSON during render', () => {
    const src = read('src/components/MeetingWorkspace/NotesTab.tsx')
    assert.ok(src.includes('No notes yet'), 'must show an empty state')
    assert.ok(!/summaryData=\{\{[^}]*JSON\.parse\(/.test(src), 'must not parse inside the render prop')
    assert.ok(src.includes('role="status"'), 'loading/save state must be announced')
    assert.ok(src.includes('role="alert"'), 'error state must be announced')
  })

  it('NotesTab flushes the live editor before persisting', () => {
    const src = read('src/components/MeetingWorkspace/NotesTab.tsx')
    assert.ok(
      /editor\?\.isDirty[\s\S]{0,120}saveSummary\(\)/.test(src),
      'Save must flush the dirty editor, else it can persist stale content'
    )
  })

  it('TasksTab keeps existing action items visible when a refresh fails', () => {
    const src = read('src/components/MeetingWorkspace/TasksTab.tsx')
    assert.ok(
      /if \(error && tasks\.length === 0 && intelligence === null\)/.test(src),
      'a failed refresh must not replace already-loaded action items'
    )
    // And when content does survive, the failure must still be surfaced inline.
    assert.ok(
      /\{error && \(\s*<div\s+role="alert"/.test(src),
      'a non-destructive failure must render an inline alert'
    )
  })
})

describe('Gate 8: motion respects user preference', () => {
  it('animated surfaces pair animation with a reduced-motion opt-out', () => {
    for (const rel of STYLED_FILES) {
      const src = stripComments(read(rel))
      const animations = src.match(/\banimate-(spin|pulse|bounce|ping)\b/g) || []
      if (animations.length === 0) continue
      assert.ok(
        /motion-reduce:animate-none|motion-safe:animate-/.test(src),
        `${rel} animates (${animations.join(', ')}) without a motion-reduce opt-out`
      )
    }
  })
})

describe('Gate 8: Gate 7 intelligence behaviour is untouched', () => {
  it('ContextTab still delegates ranking and provenance to the shared helpers', () => {
    const src = read('src/components/MeetingWorkspace/ContextTab.tsx')
    assert.ok(src.includes('rankContextMemoryItems'), 'must keep shared ranking')
    assert.ok(src.includes('provenanceLinkForItem'), 'must keep shared provenance links')
  })

  it('ContextTab still links out to context management', () => {
    const src = read('src/components/MeetingWorkspace/ContextTab.tsx')
    assert.ok(src.includes('routes.contexts()'), 'must keep the manage-contexts link')
  })
})
