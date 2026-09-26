import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..', '..');

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const srcRoot = path.join(frontendRoot, 'src');

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: (spec) => {
      if (spec.startsWith('@/')) {
        const target = path.join(srcRoot, spec.slice(2));
        return loadTsModule(target.endsWith('.ts') ? target : `${target}.ts`);
      }
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filePath), spec);
        return loadTsModule(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
      }
      return import(spec);
    },
  });
  return module.exports;
}

const plain = (val) => JSON.parse(JSON.stringify(val));

const contextTypesPath = path.join(frontendRoot, 'src', 'types', 'context.ts');
const {
  calculateMemoryItemScore,
  compareContextMemoryItems,
  rankContextMemoryItems,
  provenanceLinkForItem,
} = loadTsModule(contextTypesPath);

describe('Phase 5 Gate 7 — Scoring & Ranking Model', () => {
  const fixedNow = 1700000000000;
  const dayMs = 86400000;
  const rfcNow = new Date(fixedNow).toISOString();

  it('preserves exact kind hierarchy base weights', () => {
    const scoreAction = calculateMemoryItemScore({ kind: 'action', status: 'open', updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreQuestion = calculateMemoryItemScore({ kind: 'question', status: 'open', updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreDecision = calculateMemoryItemScore({ kind: 'decision', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreFact = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreNote = calculateMemoryItemScore({ kind: 'note', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreClosedAction = calculateMemoryItemScore({ kind: 'action', status: 'done', updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const scoreClosedQuestion = calculateMemoryItemScore({ kind: 'question', status: 'resolved', updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);

    assert.equal(scoreAction, 100.0);
    assert.equal(scoreQuestion, 85.0);
    assert.equal(scoreDecision, 70.0);
    assert.equal(scoreFact, 55.0);
    assert.equal(scoreNote, 40.0);
    assert.equal(scoreClosedAction, 15.0);
    assert.equal(scoreClosedQuestion, 15.0);

    assert.ok(scoreAction > scoreQuestion);
    assert.ok(scoreQuestion > scoreDecision);
    assert.ok(scoreDecision > scoreFact);
    assert.ok(scoreFact > scoreNote);
    assert.ok(scoreNote > scoreClosedAction);
  });

  it('exhibits strictly monotonic recency decay with 30-day half-life', () => {
    const score0d = calculateMemoryItemScore({ kind: 'decision', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const score15d = calculateMemoryItemScore({ kind: 'decision', status: null, updatedAt: new Date(fixedNow - 15 * dayMs).toISOString(), createdAt: '' }, fixedNow, 1);
    const score30d = calculateMemoryItemScore({ kind: 'decision', status: null, updatedAt: new Date(fixedNow - 30 * dayMs).toISOString(), createdAt: '' }, fixedNow, 1);
    const score60d = calculateMemoryItemScore({ kind: 'decision', status: null, updatedAt: new Date(fixedNow - 60 * dayMs).toISOString(), createdAt: '' }, fixedNow, 1);

    assert.equal(score0d, 70.0);
    assert.equal(score30d, 35.0); // exactly half
    assert.ok(score0d > score15d);
    assert.ok(score15d > score30d);
    assert.ok(score30d > score60d);
  });

  it('safely handles missing, invalid, and clock-skew future timestamps', () => {
    const scoreInvalid = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: 'not-a-date', createdAt: '' }, fixedNow, 1);
    assert.equal(scoreInvalid, 5.5); // 55.0 * 0.1 floor

    const scoreFuture = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: new Date(fixedNow + 500000).toISOString(), createdAt: '' }, fixedNow, 1);
    assert.equal(scoreFuture, 55.0); // clamped to 0 days age
  });

  it('applies frequency multiplier bounded between 1.0x and 2.0x', () => {
    const score1x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 1);
    const score2x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 2);
    const score3x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 3);
    const score4x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 4);
    const score5x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 5);
    const score10x = calculateMemoryItemScore({ kind: 'fact', status: null, updatedAt: rfcNow, createdAt: rfcNow }, fixedNow, 10);

    assert.equal(score1x, 55.0);
    assert.equal(score2x, 68.75); // 1.25x
    assert.equal(score3x, 82.5);  // 1.50x
    assert.equal(score4x, 96.25); // 1.75x
    assert.equal(score5x, 110.0); // 2.0x
    assert.equal(score10x, 110.0); // clamped
  });

  it('ranks items by score descending with 4-stage deterministic tie-breaking', () => {
    const itemAction = { id: 'a1', contextId: 'c1', kind: 'action', content: 'Action 1', status: 'open', updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm1' };
    const itemOlderAction = { id: 'a2', contextId: 'c1', kind: 'action', content: 'Action 2', status: 'open', updatedAt: new Date(fixedNow - 10 * dayMs).toISOString(), createdAt: '', sourceMeetingId: 'm1' };
    const itemDecision = { id: 'd1', contextId: 'c1', kind: 'decision', content: 'Decision 1', status: null, updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm1' };
    const itemFact = { id: 'f1', contextId: 'c1', kind: 'fact', content: 'Fact 1', status: null, updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm1' };

    const ranked = rankContextMemoryItems([itemFact, itemDecision, itemOlderAction, itemAction], fixedNow);
    assert.deepEqual(plain(ranked.map(i => i.id)), ['a1', 'a2', 'd1', 'f1']);

    // Tie-breaking
    const tieZ = { id: 'id-z', contextId: 'c1', kind: 'fact', content: 'Fact', status: null, updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm-alpha' };
    const tieA = { id: 'id-a', contextId: 'c1', kind: 'fact', content: 'Fact', status: null, updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm-alpha' };
    const tieBeta = { id: 'id-1', contextId: 'c1', kind: 'fact', content: 'Fact', status: null, updatedAt: rfcNow, createdAt: rfcNow, sourceMeetingId: 'm-beta' };

    const rankedTies = rankContextMemoryItems([tieZ, tieBeta, tieA], fixedNow);
    assert.deepEqual(plain(rankedTies.map(i => i.id)), ['id-a', 'id-z', 'id-1']);
  });
});

describe('Phase 5 Gate 7 — Rust Prompt Protection & Budget Bounds', () => {
  const modelRsPath = path.join(frontendRoot, 'src-tauri', 'src', 'context', 'model.rs');
  const renderRsPath = path.join(frontendRoot, 'src-tauri', 'src', 'context', 'render.rs');
  const summaryServicePath = path.join(frontendRoot, 'src-tauri', 'src', 'summary', 'service.rs');
  const repositoryRsPath = path.join(frontendRoot, 'src-tauri', 'src', 'context', 'repository.rs');

  const modelRs = fs.readFileSync(modelRsPath, 'utf8');
  const renderRs = fs.readFileSync(renderRsPath, 'utf8');
  const summaryService = fs.readFileSync(summaryServicePath, 'utf8');
  const repositoryRs = fs.readFileSync(repositoryRsPath, 'utf8');

  it('defines HARD_MAX_CONTEXT_BUDGET_TOKENS as 4000', () => {
    assert.match(modelRs, /pub const HARD_MAX_CONTEXT_BUDGET_TOKENS:\s*usize\s*=\s*4000;/);
  });

  it('defines MAX_RENDERED_CONTEXT_CHARS as 16_000', () => {
    assert.match(modelRs, /pub const MAX_RENDERED_CONTEXT_CHARS:\s*usize\s*=\s*16_?000;/);
  });

  it('sanitizes MemoryBudget by clamping context_tokens and per_item_max_chars', () => {
    assert.match(modelRs, /context_tokens:\s*self[\s\S]*?\.context_tokens[\s\S]*?\.clamp\(MIN_CONTEXT_BUDGET_TOKENS,\s*HARD_MAX_CONTEXT_BUDGET_TOKENS\)/);
    assert.match(modelRs, /per_item_max_chars:\s*self[\s\S]*?\.per_item_max_chars[\s\S]*?\.clamp\(50,\s*EXTRACTED_ITEM_CONTENT_MAX_CHARS\)/);
  });

  it('enforces MAX_RENDERED_CONTEXT_CHARS in render_inner_content_at', () => {
    assert.match(renderRs, /combined_markdown\.chars\(\)\.count\(\)\s*>\s*crate::context::model::MAX_RENDERED_CONTEXT_CHARS/);
  });

  it('orders candidate item views by cmi.updated_at DESC in repository query', () => {
    assert.match(repositoryRs, /ORDER BY cmi\.updated_at DESC,\s*cmi\.id ASC/);
  });

  it('clamps context_ids to MAX_CONTEXTS_PER_SUMMARY in summary service', () => {
    assert.match(summaryService, /take\(crate::context::model::MAX_CONTEXTS_PER_SUMMARY\)/);
  });
});

describe('Phase 5 Gate 7 — Workspace ContextTab Component Architecture & UX', () => {
  const contextTabPath = path.join(frontendRoot, 'src', 'components', 'MeetingWorkspace', 'ContextTab.tsx');
  const contextTabContent = fs.readFileSync(contextTabPath, 'utf8');

  it('isolates context membership using memberContextIds Set without cross-contamination', () => {
    assert.match(contextTabContent, /const\s+\[memberContextIds,\s*setMemberContextIds\]\s*=\s*useState<Set<string>>/);
    assert.match(contextTabContent, /const\s+isInContext\s*=\s*memberContextIds\.has\(context\.id\);/);
    assert.doesNotMatch(contextTabContent, /const\s+isInContext\s*=\s*contextMeetings\.some/);
  });

  it('loads and displays continuous context memory on context selection', () => {
    assert.match(contextTabContent, /contextService\.getCompactContextMemory/);
    assert.match(contextTabContent, /rankContextMemoryItems\(selectedMemory\.items\)/);
    assert.match(contextTabContent, /selectedMemory\?\.memoryMarkdown/);
  });

  it('renders truthful provenance links using provenanceLinkForItem', () => {
    assert.match(contextTabContent, /provenanceLinkForItem\(item\)/);
    assert.match(contextTabContent, /manual entry/);
  });

  it('implements accessible non-nested button card container', () => {
    // Card outer container must NOT have role="button"
    assert.doesNotMatch(contextTabContent, /<div[^>]*role="button"[^>]*>[\s\S]*?<button/);
  });

  it('provides accessible loading and error states with role="status" and role="alert"', () => {
    assert.match(contextTabContent, /role="status"/);
    assert.match(contextTabContent, /role="alert"/);
    // Element name is intentionally not asserted: the retry control may be a raw
    // <button> or the shared <Button> primitive. What matters is that it retries.
    assert.match(contextTabContent, /<(?:button|Button)[^>]*onClick=\{loadContexts\}[^>]*>\s*Retry\s*<\/(?:button|Button)>/);
  });

  it('provides empty state with link to manage contexts', () => {
    assert.match(contextTabContent, /routes\.contexts\(\)/);
    assert.match(contextTabContent, /Create First Context/);
  });

  it('uses semantic tokens exclusively with ZERO hardcoded gray palette classes', () => {
    const hardcodedGrayRegex = /\b(bg|text|border)-(gray|slate|zinc|neutral|stone)-[0-9]{2,3}\b/;
    assert.equal(hardcodedGrayRegex.test(contextTabContent), false, 'ContextTab must not contain hardcoded gray classes');
  });

  it('enforces strict safety invariants: ZERO alert, confirm, or prompt calls', () => {
    assert.doesNotMatch(contextTabContent, /\balert\s*\(/);
    assert.doesNotMatch(contextTabContent, /\bconfirm\s*\(/);
    assert.doesNotMatch(contextTabContent, /\bprompt\s*\(/);
  });
});
