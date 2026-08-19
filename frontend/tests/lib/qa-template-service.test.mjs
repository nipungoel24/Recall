// QA regression suite for the template service wrapper
// (src/services/templateService.ts).
//
// The Tauri `invoke` bridge is replaced with a recording stub so the service
// layer's command names, argument shapes, and client-side guards can be
// verified without a running backend.
//
// Runnable with:  node --test tests/lib/qa-template-service.test.mjs
//                 pnpm exec bun test tests/lib/qa-template-service.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadTsModule(filePath, requireShim) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: requireShim ?? (() => {
      throw new Error('unexpected require');
    }),
    console,
  });
  return module.exports;
}

const calls = [];
const plain = (v) => JSON.parse(JSON.stringify(v));
function makeInvokeStub(handlers) {
  calls.length = 0;
  return (command, args) => {
    calls.push({ command, args: plain(args ?? {}) });
    const h = handlers[command];
    if (h === undefined) {
      return Promise.reject(`command not found: ${command}`);
    }
    if (h instanceof Error) return Promise.reject(h);
    if (typeof h === 'function') return Promise.resolve(h(args));
    return Promise.resolve(h);
  };
}

function loadService(handlers) {
  const schema = loadTsModule(path.join(here, '..', '..', 'src', 'lib', 'template-schema.ts'));
  const service = loadTsModule(
    path.join(here, '..', '..', 'src', 'services', 'templateService.ts'),
    (spec) => {
      if (spec === '@tauri-apps/api/core') return { invoke: makeInvokeStub(handlers) };
      if (spec === '@/lib/template-schema') return schema;
      throw new Error(`unexpected require: ${spec}`);
    }
  );
  return service;
}

const validJson = JSON.stringify({
  name: 'Custom',
  description: 'D',
  sections: [{ title: 'T', instruction: 'I', format: 'paragraph' }],
});

test('saveTemplate: malformed definition never reaches the backend', async () => {
  const service = loadService({});
  await assert.rejects(() => service.saveTemplate('x', 'not json'), /not valid JSON/);
  assert.equal(calls.length, 0, 'no invoke call made');
});

test('saveTemplate: sends the in-tree command name with templateId/templateJson args', async () => {
  const service = loadService({
    api_list_templates: [],
    api_create_custom_template: { name: 'Custom' },
  });
  const saved = await service.saveTemplate('my_id', validJson);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'api_list_templates');
  assert.equal(calls[1].command, 'api_create_custom_template');
  assert.deepEqual(calls[1].args, { templateId: 'my_id', templateJson: validJson });
  assert.equal(saved.source, 'custom');
  assert.equal(saved.id, 'my_id');
});

test('saveTemplate: path-traversal ids are sent as-is (backend sanitizes)', async () => {
  // FE does NOT sanitize ids; the contract puts sanitization on the backend
  // (templates/store.rs::sanitize_template_id). Pin that the FE forwards raw.
  const service = loadService({ api_list_templates: [], api_create_custom_template: {} });
  await service.saveTemplate('../../evil', validJson);
  assert.equal(calls[1].args.templateId, '../../evil');
});

test('saveTemplate: surfaces backend validation errors', async () => {
  const service = loadService({ api_create_custom_template: new Error('Template name cannot be empty') });
  await assert.rejects(() => service.saveTemplate('x', validJson), /name cannot be empty/);
});

test('deleteTemplate: sends the in-tree command name', async () => {
  const service = loadService({ api_delete_custom_template: null });
  await service.deleteTemplate('my_id');
  assert.equal(calls[0].command, 'api_delete_custom_template');
  assert.deepEqual(calls[0].args, { templateId: 'my_id' });
});

test('deleteTemplate: surfaces built-in rejection from the backend', async () => {
  const service = loadService({ api_delete_custom_template: new Error('built-in and cannot be deleted') });
  await assert.rejects(() => service.deleteTemplate('daily_standup'), /built-in/);
});

test('deleteTemplate: missing backend command gets a friendly error', async () => {
  const service = loadService({});
  await assert.rejects(
    () => service.deleteTemplate('x'),
    /not available yet \(backend command "api_delete_custom_template" not found\)/
  );
});

test('getTemplateJson / validateTemplateOnBackend wire the right commands', async () => {
  const service = loadService({
    api_get_template_json: validJson,
    api_validate_template: 'Custom',
  });
  const json = await service.getTemplateJson('abc');
  assert.equal(json, validJson);
  assert.equal(calls[0].command, 'api_get_template_json');
  assert.deepEqual(calls[0].args, { templateId: 'abc' });

  const name = await service.validateTemplateOnBackend(validJson);
  assert.equal(name, 'Custom');
  assert.equal(calls[1].command, 'api_validate_template');
});

test('getTemplateDefinition: parses valid JSON, rejects malformed backend payload', async () => {
  const okService = loadService({ api_get_template_json: validJson });
  const def = await okService.getTemplateDefinition('abc');
  assert.equal(def.name, 'Custom');

  const badService = loadService({ api_get_template_json: '{not json' });
  await assert.rejects(() => badService.getTemplateDefinition('abc'), /not valid JSON/);
});

test('listTemplates: tolerates non-array responses and normalizes entries', async () => {
  const service = loadService({
    api_list_templates: [
      { id: 'daily_standup', name: 'Daily Standup', description: 'd' },
      { id: 'my_custom', name: 'Mine', description: 'd', source: 'custom' },
      { id: 'weird', source: 'nonsense' },
      null,
    ],
  });
  const templates = await service.listTemplates();
  assert.equal(templates.length, 4);
  assert.equal(templates[0].source, 'builtin', 'known builtin id inferred');
  assert.equal(templates[1].source, 'custom');
  assert.equal(templates[2].source, 'unknown', 'unknown sources are read-only');
  assert.equal(templates[3].id, '', 'malformed entry degrades');

  const emptyService = loadService({ api_list_templates: { not: 'an array' } });
  assert.deepEqual([...await emptyService.listTemplates()], []);
});

test('listTemplates: wraps backend failures with the command name', async () => {
  const service = loadService({ api_list_templates: new Error('db locked') });
  await assert.rejects(() => service.listTemplates(), /db locked/);
});
