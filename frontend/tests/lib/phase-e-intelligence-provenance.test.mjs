/**
 * Workstream E regression tests: Meeting Intelligence command contract and
 * evidence provenance.
 *
 * Guards the boundary defects that made the entire Meeting Intelligence write
 * path unreachable and its provenance unusable. The exhaustive state machine is
 * covered by the Rust suites in
 * `src-tauri/src/summary/intelligence_evidence.rs` and
 * `src-tauri/src/summary/tests_intelligence_provenance.rs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src-tauri', 'src');
const code = (p) => readFileSync(p, 'utf8');

const commands = code(join(root, 'summary', 'intelligence_commands.rs'));
const service = code(join(root, 'summary', 'service.rs'));

const serviceTs = readFileSync(
  join(process.cwd(), 'src', 'services', 'meetingIntelligenceService.ts'),
  'utf8',
);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const commandsCode = stripComments(commands);
const serviceCode = stripComments(service);

test('WS-E: the generate request deserializes the camelCase the frontend sends', () => {
  // Tauri camelCases only the TOP-LEVEL argument key. The nested struct goes
  // through serde verbatim, so without a container-level rename_all the
  // frontend's {meetingId, ...} failed with `missing field meeting_id` and the
  // command was 100% dead.
  assert.match(
    commandsCode,
    /#\[serde\(rename_all = "camelCase"\)\]\s*pub struct GenerateIntelligenceRequest/,
    'GenerateIntelligenceRequest must declare a container-level camelCase rename',
  );
  assert.match(
    commandsCode,
    /pub meeting_id: String/,
    'the Rust field name must still be snake_case; serde maps it',
  );
});

test('WS-E: the generate response is flat, not nested', () => {
  // The backend returned {meeting_id, intelligence:{abstract,...}} while the
  // frontend read top-level abstract_text/topics/..., so result.topics.map threw.
  for (const key of [
    'abstract_text',
    'topics',
    'decisions',
    'actions',
    'questions',
    'facts',
    'follow_ups',
  ]) {
    assert.match(
      commandsCode,
      new RegExp(`pub ${key}:`),
      `the response must expose '${key}' at the top level`,
    );
  }
  assert.doesNotMatch(
    commandsCode,
    /"intelligence"\s*:/,
    "the nested 'intelligence' wrapper is the defect and must not return",
  );
});

test('WS-E: generate returns the persisted rows, not raw model output', () => {
  assert.match(
    commandsCode,
    /load_intelligence_items/,
    'the command must read back what it stored so generate and get agree',
  );
});

test('WS-E: evidence is built from real segment ids of this meeting', () => {
  // The id was discarded at the call site and replaced with joined plain text,
  // so the model was asked for segment ids it had never seen.
  assert.match(
    commandsCode,
    /EvidenceCatalog::build/,
    'the command must build an evidence catalog from the meeting transcripts',
  );
  assert.doesNotMatch(
    commandsCode,
    /\.map\(\|t\| t\.text\.clone\(\)\)\s*\.collect::<Vec<_>>\(\)\s*\.join\("\\n"\)/,
    'the bare joined-text transcript must not be handed to generation again',
  );
});

test('WS-E: the prompt asks for request-local references, not database ids', () => {
  assert.match(
    serviceCode,
    /"sourceRefs"/,
    'the schema must ask the model for citable references',
  );
  assert.match(
    serviceCode,
    /source_segment_ids: Vec<String>/,
    'the resolved ids stay a separate, server-populated field',
  );
  // The transcript must be rendered once, not embedded twice.
  const renderCalls = (serviceCode.match(/evidence\.render\(\)/g) || []).length;
  assert.equal(renderCalls, 1, 'the transcript view must be rendered exactly once');
  assert.doesNotMatch(
    serviceCode,
    /transcript_with_ids/,
    'the duplicated "transcript with ids" embedding must be gone',
  );
});

test('WS-E: unresolvable evidence does not delete the intelligence item', () => {
  // This was the defect that left Tasks permanently empty: every non-topic
  // item whose ids failed to resolve was dropped.
  assert.doesNotMatch(
    serviceCode,
    /\.retain\(\|item\| !item\.source_segment_ids\.is_empty\(\)\)/,
    'items must never be deleted for lacking evidence; they become unverified',
  );
  assert.match(
    serviceCode,
    /item\.has_evidence = !item\.source_segment_ids\.is_empty\(\)/,
    'an item with no resolvable citation must be marked explicitly unverified',
  );
});

test('WS-E: the abstract and the items are persisted in one transaction', () => {
  // Two autocommit calls meant a failure between them left a new abstract above
  // the previous run's items.
  assert.match(
    serviceCode,
    /replace_all\(/,
    'generation must use the atomic replace',
  );
  const repo = code(
    join(root, 'database', 'repositories', 'meeting_intelligence.rs'),
  );
  const replaceAll = repo.slice(repo.indexOf('pub async fn replace_all'));
  const commitIdx = replaceAll.indexOf('tx.commit()');
  const upsertIdx = replaceAll.indexOf('upsert_intelligence_tx');
  assert.ok(upsertIdx > -1 && commitIdx > -1, 'replace_all must upsert then commit');
  assert.ok(
    upsertIdx < commitIdx,
    'the abstract upsert must be inside the transaction that commits',
  );
});

test('WS-E: context selection preserves the user order deterministically', () => {
  // A HashSet made "which 2 of 3+ selected contexts" vary per app launch.
  assert.doesNotMatch(
    serviceCode,
    /collect::<std::collections::HashSet<_>>\(\)\s*\.into_iter\(\)/,
    'HashSet iteration must not drive context selection',
  );
  assert.match(
    serviceCode,
    /seen_context_ids\.insert/,
    'dedup must preserve the selection order',
  );

  const commandsSvc = code(join(root, 'summary', 'commands.rs'));
  assert.doesNotMatch(
    stripComments(commandsSvc),
    /collect::<std::collections::HashSet<_>>\(\)\s*\.into_iter\(\)/,
    'summary context selection must also preserve order',
  );
});

test('WS-E: model output is validated rather than trusted', () => {
  const validation = code(join(root, 'summary', 'intelligence_validation.rs'));
  assert.match(
    validation,
    /pub fn clamp_confidence/,
    'confidence must be clamped to [0,1] before it is rendered as a percentage',
  );
  assert.match(
    validation,
    /pub fn normalize_due_date/,
    'vague due dates must be rejected, not stored verbatim',
  );
  assert.match(validation, /pub fn normalize_status/, 'status must be a closed set');
  assert.match(
    validation,
    /pub fn parse_json_output/,
    'fenced and prose-wrapped JSON must parse; malformed output must error',
  );
  assert.match(
    serviceCode,
    /intelligence_validation::clamp_confidence/,
    'generation must apply the validation, not merely define it',
  );
});

test('WS-E: evidence navigation tolerates missing timestamps', () => {
  // The position query decoded a nullable column as a non-optional f64, so any
  // segment recorded before audio-sync timestamps existed hard-errored.
  assert.doesNotMatch(
    commandsCode,
    /query_as\("SELECT audio_start_time FROM transcripts WHERE id = \? AND meeting_id = \?"\)/,
    'a nullable column must not be decoded as non-nullable f64',
  );
  assert.match(
    commandsCode,
    /COALESCE\(audio_start_time, 0\.0\)/,
    'ordering must coerce NULL timestamps the same way the client does',
  );
  assert.match(
    commandsCode,
    /AND id < \?/,
    'ties must break deterministically on segment id',
  );
});

test('WS-E: the frontend still reads the fields the backend returns', () => {
  // The service reads top-level fields; this guards against a future backend
  // shape change reintroducing the mismatch that made the feature dead.
  assert.match(serviceTs, /result\.abstract_text/);
  assert.match(serviceTs, /result\.topics\.map/);
  assert.doesNotMatch(
    serviceTs,
    /result\.intelligence/,
    "the frontend must not read a nested 'intelligence' object",
  );
});