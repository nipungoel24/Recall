// QA regression suite for the template schema module
// (src/lib/template-schema.ts).
//
// Adversarial additions on top of template-schema.test.ts: validation
// fuzzing, serialization round-trips, slug edge cases, built-in protection
// matrix, and explicit pinning of the known FE/BE contract deltas so the
// integration owner cannot miss them.
//
// Runnable with:  node --test tests/lib/qa-template-schema.test.mjs
//                 pnpm exec bun test tests/lib/qa-template-schema.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const modulePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'lib',
  'template-schema.ts'
);

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const moduleObj = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: moduleObj.exports,
    module: moduleObj,
    require: (spec) => {
      throw new Error(`template-schema.ts must not import modules (got: ${spec})`);
    },
  });
  return moduleObj.exports;
}

const {
  parseTemplateDefinition,
  validateTemplateDefinition,
  definitionToJson,
  slugifyTemplateId,
  isValidTemplateId,
  isCustomTemplate,
  isBuiltinTemplate,
  BUILTIN_TEMPLATE_IDS,
  createEmptyDefinition,
  createEmptySection,
} = loadTsModule(modulePath);

const validJson = JSON.stringify({
  name: 'My Template',
  description: 'A description',
  sections: [
    { title: 'Summary', instruction: 'Summarize', format: 'paragraph' },
  ],
});

// ---------------------------------------------------------------------------
// parseTemplateDefinition fuzzing
// ---------------------------------------------------------------------------

test('parse: rejects non-objects, arrays, and empty documents', () => {
  for (const bad of ['null', '[]', '""', '42', 'true']) {
    const r = parseTemplateDefinition(bad);
    assert.equal(r.ok, false, `expected rejection for ${bad}`);
  }
});

test('parse: rejects missing/blank top-level fields', () => {
  const cases = [
    ['{"description":"d","sections":[{"title":"t","instruction":"i","format":"paragraph"}]}', 'name'],
    ['{"name":"n","sections":[{"title":"t","instruction":"i","format":"paragraph"}]}', 'description'],
    ['{"name":"n","description":"d"}', 'sections'],
    ['{"name":"  ","description":"d","sections":[{"title":"t","instruction":"i","format":"paragraph"}]}', 'blank name'],
    ['{"name":"n","description":"","sections":[{"title":"t","instruction":"i","format":"paragraph"}]}', 'blank description'],
    ['{"name":"n","description":"d","sections":[]}', 'empty sections'],
  ];
  for (const [json, label] of cases) {
    assert.equal(parseTemplateDefinition(json).ok, false, label);
  }
});

test('parse: rejects invalid sections and reports 1-based index', () => {
  assert.match(parseTemplateDefinition(JSON.stringify({
    name: 'n', description: 'd',
    sections: [
      { title: 'ok', instruction: 'ok', format: 'paragraph' },
      null,
    ],
  })).error, /Section 2/);

  assert.match(parseTemplateDefinition(JSON.stringify({
    name: 'n', description: 'd',
    sections: [{ title: 'ok', instruction: 'ok', format: 'markdown' }],
  })).error, /invalid format/);
});

test('parse: trims and preserves only supported optional fields', () => {
  const r = parseTemplateDefinition(JSON.stringify({
    name: ' N ',
    description: ' D ',
    sections: [
      {
        title: ' T ',
        instruction: ' I ',
        format: 'list',
        item_format: '  - ',
        example_item_format: '',
        unknown_field: 'dropped',
      },
    ],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.value.name, ' N ', 'name kept raw at parse level (trim happens in definitionToJson)');
  assert.equal(r.value.sections[0].item_format, '  - ');
  assert.equal(r.value.sections[0].example_item_format, undefined);
  assert.equal(r.value.sections[0].unknown_field, undefined);
});

test('parse: accepts unicode and injection-looking text as plain strings', () => {
  const r = parseTemplateDefinition(JSON.stringify({
    name: 'Template <script>alert(1)</script>',
    description: 'D',
    sections: [{ title: '<img src=x>', instruction: 'summarize; DROP TABLE meetings;--', format: 'string' }],
  }));
  assert.equal(r.ok, true, 'schema layer stores strings verbatim (no HTML/SQL interpretation)');
});

// ---------------------------------------------------------------------------
// validateTemplateDefinition
// ---------------------------------------------------------------------------

test('validate: empty definition reports name/description and form errors', () => {
  const errors = validateTemplateDefinition(createEmptyDefinition());
  assert.equal(errors.name, 'Name is required');
  assert.equal(errors.description, 'Description is required');
  assert.equal(errors.form, undefined, 'single empty section is a valid section shape');
});

test('validate: per-section errors are positional', () => {
  const def = {
    name: 'n',
    description: 'd',
    sections: [
      { title: '', instruction: '', format: 'bogus' },
      { title: 'fine', instruction: 'fine', format: 'paragraph' },
    ],
  };
  const errors = validateTemplateDefinition(def);
  assert.equal(errors.sections.length, 2);
  assert.ok(errors.sections[0], 'first section has errors');
  assert.equal(errors.sections[0].title, 'Section title is required');
  assert.equal(errors.sections[0].instruction, 'Instruction is required');
  assert.equal(errors.sections[0].format, 'Choose paragraph, list, or string');
  assert.equal(errors.sections[1], null, 'second section is clean');
});

// ---------------------------------------------------------------------------
// definitionToJson round-trip
// ---------------------------------------------------------------------------

test('definitionToJson: trims, drops blank optionals, parses back', () => {
  const def = {
    name: '  Name  ',
    description: '  Desc  ',
    sections: [
      { title: '  T ', instruction: ' I ', format: 'paragraph', item_format: '   ', example_item_format: 'e' },
    ],
  };
  const json = definitionToJson(def);
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, 'Name');
  assert.equal(parsed.description, 'Desc');
  assert.equal(parsed.sections[0].title, 'T');
  assert.equal(parsed.sections[0].instruction, 'I');
  assert.equal('item_format' in parsed.sections[0], false, 'blank optional dropped');
  assert.equal(parsed.sections[0].example_item_format, 'e');

  const re = parseTemplateDefinition(json);
  assert.equal(re.ok, true);
  assert.equal(re.value.name, 'Name');
});

// ---------------------------------------------------------------------------
// slugifyTemplateId
// ---------------------------------------------------------------------------

test('slugify: standard transformations', () => {
  assert.equal(slugifyTemplateId('Hello World 2'), 'hello_world_2');
  assert.equal(slugifyTemplateId('  Leading Trailing  '), 'leading_trailing');
  assert.equal(slugifyTemplateId('UPPER_case'), 'upper_case');
  assert.equal(slugifyTemplateId('___'), 'custom_template');
  assert.equal(slugifyTemplateId(''), 'custom_template');
  assert.equal(slugifyTemplateId('!!!'), 'custom_template');
  assert.equal(slugifyTemplateId('日本語 テンプレート'), 'custom_template', 'non-latin collapses');
  assert.equal(slugifyTemplateId('a.-b'), 'a_b', 'dots become underscores');
  assert.equal(slugifyTemplateId('C++ Notes'), 'c_notes');
});

test('slugify output always passes isValidTemplateId', () => {
  const samples = ['Standup', 'Q3 Review', '1:1 with Sam', 'A/B', 'Überblick', '  x  ', '--'];
  for (const s of samples) {
    const slug = slugifyTemplateId(s);
    assert.ok(isValidTemplateId(slug), `slug for ${JSON.stringify(s)} is valid`);
  }
});

// ---------------------------------------------------------------------------
// isValidTemplateId vs the backend contract
// ---------------------------------------------------------------------------

// Backend contract (MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md 4.1):
//   ^[a-z0-9][a-z0-9_-]{0,63}$
// This test PINS the current frontend behavior and the known deltas so the
// integration owner must consciously resolve them.
test('isValidTemplateId: current frontend behavior (pinned)', () => {
  assert.ok(isValidTemplateId('abc'));
  assert.ok(isValidTemplateId('a1_b2'));
  assert.ok(isValidTemplateId('_leading_underscore'), 'FE allows leading underscore');
  assert.ok(isValidTemplateId('a'.repeat(100)), 'FE has NO length cap');
  assert.ok(!isValidTemplateId('has-dash'), 'FE rejects dashes');
  assert.ok(!isValidTemplateId('UpperCase'));
  assert.ok(!isValidTemplateId(''));
});

test('CONTRACT DELTA (pinned for integration review): dashes and length', () => {
  const backendContractPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  // Backend accepts; frontend rejects. Users can never create dashed ids via UI.
  assert.ok(backendContractPattern.test('standup-weekly'));
  assert.ok(!isValidTemplateId('standup-weekly'));
  // Backend rejects; frontend accepts. A 100-char id passes FE checks and is
  // rejected by the backend at save time.
  assert.ok(isValidTemplateId('a'.repeat(100)));
  assert.ok(!backendContractPattern.test('a'.repeat(100)));
});

// ---------------------------------------------------------------------------
// Built-in protection matrix
// ---------------------------------------------------------------------------

test('isBuiltinTemplate protects embedded ids regardless of reported source', () => {
  for (const id of BUILTIN_TEMPLATE_IDS) {
    assert.ok(isBuiltinTemplate({ id, source: 'custom' }), `${id} is protected even if source is misreported`);
    assert.ok(isBuiltinTemplate({ id, source: 'builtin' }));
    assert.ok(isBuiltinTemplate({ id, source: 'unknown' }));
  }
});

test('isBuiltinTemplate protects bundled templates only via source', () => {
  // Bundled ids are NOT in the FE hard-coded list; protection relies on the
  // backend reporting source='bundled'.
  assert.ok(isBuiltinTemplate({ id: 'project_sync', source: 'bundled' }));
  assert.ok(!isBuiltinTemplate({ id: 'project_sync', source: 'unknown' }),
    'FE cannot know bundled ids until the backend reports source');
});

test('isCustomTemplate is true only for custom source', () => {
  assert.ok(isCustomTemplate({ source: 'custom' }));
  assert.ok(!isCustomTemplate({ source: 'builtin' }));
  assert.ok(!isCustomTemplate({ source: 'bundled' }));
  assert.ok(!isCustomTemplate({ source: 'unknown' }));
});

// ---------------------------------------------------------------------------
// Empty factories
// ---------------------------------------------------------------------------

test('factories: empty definition has one valid-shape empty section', () => {
  const def = createEmptyDefinition();
  assert.equal(def.sections.length, 1);
  const section = createEmptySection();
  assert.deepEqual({ ...section }, { title: '', instruction: '', format: 'paragraph' });
});
