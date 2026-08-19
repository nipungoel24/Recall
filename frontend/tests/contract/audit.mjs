#!/usr/bin/env node
/**
 * Meetily Intelligence — contract conformance audit.
 *
 * Adversarial QA gate over docs/MEETILY_INTELLIGENCE_IMPLEMENTATION_CONTRACT.md
 * (binding). Checks the parts of the contract that are cheap to verify from
 * source and that have historically drifted during parallel implementation:
 * migration numbering, DB schema, Tauri command names/registration, frontend
 * service wrappers, calendar SQL rules, delete-cascade cleanup, and FK pragma.
 *
 * Pure source analysis — no build, no services, no paid dependencies.
 *
 * Usage:  node tests/contract/audit.mjs        (from frontend/)
 * Exit:   0 = contract clean, N = number of binding violations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(frontendRoot, '..');
const tauriSrc = path.join(frontendRoot, 'src-tauri', 'src');
const migrationsDir = path.join(frontendRoot, 'src-tauri', 'migrations');

const violations = [];
const notes = [];
let passCount = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passCount += 1;
  } else {
    violations.push(`VIOLATION ${label}: ${detail}`.trim());
  }
}

function info(label, detail) {
  notes.push(`INFO ${label}: ${detail}`.trim());
}

function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const libRs = readIf(path.join(tauriSrc, 'lib.rs')) ?? '';
const meetingRepo = readIf(path.join(tauriSrc, 'database', 'repositories', 'meeting.rs')) ?? '';
const managerRs = readIf(path.join(tauriSrc, 'database', 'manager.rs')) ?? '';
const apiRs = readIf(path.join(tauriSrc, 'api', 'api.rs')) ?? '';
const templateService = readIf(path.join(frontendRoot, 'src', 'services', 'templateService.ts')) ?? '';
const dailyService = readIf(path.join(frontendRoot, 'src', 'services', 'dailyService.ts')) ?? '';
const meetingService = readIf(path.join(frontendRoot, 'src', 'services', 'meetingService.ts')) ?? '';
const summaryCommands = readIf(path.join(tauriSrc, 'summary', 'commands.rs')) ?? '';

/* ── §11: migration numbering must be unique and daily = 20260815000001 ── */
let migrationFiles = [];
try {
  migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
} catch {
  violations.push('VIOLATION migrations: migrations directory unreadable');
}
const versions = new Map();
for (const file of migrationFiles) {
  const match = /^(\d+)_.*\.sql$/.exec(file);
  if (!match) {
    violations.push(`VIOLATION migrations: unparseable migration filename ${file}`);
    continue;
  }
  const v = match[1];
  if (versions.has(v)) {
    violations.push(
      `VIOLATION migrations: duplicate version ${v} in ${versions.get(v)} and ${file} (contract §11: daily summaries must be a distinct file 20260815000001_add_daily_summaries.sql)`,
    );
  } else {
    versions.set(v, file);
  }
}
const dailyFile = migrationFiles.find((f) => f.includes('daily_summaries'));
if (dailyFile && !dailyFile.startsWith('20260815000001')) {
  violations.push(
    `VIOLATION migrations: daily summaries migration '${dailyFile}' must be numbered 20260815000001 (contract §11), not the context-migration version`,
  );
}
check('migrations: version numbers unique and strictly ordered', violations.length === 0 && versions.size > 0);

/* ── Migration checksum manifest (§release-safety) ──
 * sqlx hard-fails when a shipped migration file's content changes after it
 * was applied to a user DB ("migration ... was previously applied but has
 * been modified"). The manifest locks every shipped migration's SHA-384 so
 * future edits are caught at review time instead of as startup panics for
 * upgrading users. NEW migration files without a manifest entry are allowed
 * (they simply have not shipped yet); EDITED files are violations. ── */
{
  const manifestPath = path.join(migrationsDir, 'checksums.json');
  let manifest = null;
  try {
    manifest = JSON.parse(readIf(manifestPath) ?? 'null');
  } catch {
    violations.push('VIOLATION migrations: checksums.json is not valid JSON');
  }
  check('migrations: checksums.json manifest exists', manifest !== null && typeof manifest === 'object');

  if (manifest && typeof manifest === 'object') {
    const crypto = await import('node:crypto');
    for (const file of migrationFiles) {
      const content = readIf(path.join(migrationsDir, file));
      if (content === null) continue;
      const actual = crypto.createHash('sha384').update(content).digest('hex');
      const recorded = manifest[file];
      if (recorded === undefined) {
        info(
          'migration manifest',
          `${file} has no manifest entry yet (new, unshipped migration — add its checksum before release)`,
        );
        continue;
      }
      check(`migrations: checksum unchanged for ${file}`, recorded === actual,
        `file was modified after shipping; users with an applied ${file} would hit a startup migration error`);
    }
    for (const file of Object.keys(manifest)) {
      if (!file.endsWith('.sql')) continue;
      if (!migrationFiles.includes(file)) {
        violations.push(`VIOLATION migrations: manifest lists missing file ${file}`);
      }
    }
  }
}

/* ── §6: binding context schema (memory_markdown + context_memory_items; no context_memory) ── */
const ctxMigrationFiles = migrationFiles.filter((f) => f.includes('context'));
const ctxSqlAll = ctxMigrationFiles
  .map((f) => readIf(path.join(migrationsDir, f)) ?? '')
  .join('\n');
const ctxSql = ctxMigrationFiles.some((f) => f.includes('threads'))
  ? (readIf(path.join(migrationsDir, ctxMigrationFiles.find((f) => f.includes('threads')))) ?? '')
  : '';
check('context migrations: contexts.memory_markdown column present', ctxSqlAll.includes('memory_markdown'));
check('context migrations: context_memory_items table present', ctxSqlAll.includes('context_memory_items'));
check(
  'context migrations: opaque context_memory table retired',
  !/CREATE TABLE IF NOT EXISTS context_memory\b/.test(ctxSqlAll),
);
check('context migration: composite PK on context_meetings', /PRIMARY KEY\s*\(\s*context_id\s*,\s*meeting_id\s*\)/.test(ctxSql));

/* ── §5.1: daily_summaries binding schema ── */
const dailySql = dailyFile ? (readIf(path.join(migrationsDir, dailyFile)) ?? '') : '';
check('daily migration: binding columns id + date', dailySql.includes('id TEXT') && dailySql.includes('date TEXT'));
check('daily migration: meeting_ids column', dailySql.includes('meeting_ids'));

/* ── §3.1 / §4.2 / §5.2 / §7.2: canonical commands registered in lib.rs ── */
const bindingCommands = [
  ['api_get_meetings_by_range', '§3.1 calendar range'],
  ['api_get_dates_with_meetings', '§3.1 calendar dates'],
  ['api_create_custom_template', '§4.2 templates'],
  ['api_update_custom_template', '§4.2 templates'],
  ['api_delete_custom_template', '§4.2 templates'],
  ['api_duplicate_template', '§4.2 templates'],
  ['api_get_template_json', '§4.2 templates'],
  ['api_generate_daily_summary', '§5.2 daily'],
  ['api_get_daily_summary', '§5.2 daily'],
  ['api_cancel_daily_summary', '§5.2 daily'],
  ['api_list_context_threads', '§7.2 context'],
  ['api_get_context_thread', '§7.2 context'],
  ['api_create_context_thread', '§7.2 context'],
  ['api_update_context_thread', '§7.2 context'],
  ['api_delete_context_thread', '§7.2 context'],
  ['api_add_meeting_to_context', '§7.2 context'],
  ['api_remove_meeting_from_context', '§7.2 context'],
  ['api_get_context_meetings', '§7.2 context'],
  ['api_get_context_memory', '§7.2 context'],
  ['api_add_context_memory_item', '§7.2 context'],
  ['api_update_context_memory_item', '§7.2 context'],
  ['api_delete_context_memory_item', '§7.2 context'],
  ['api_get_compact_context_memory', '§7.2 context'],
];
for (const [name, section] of bindingCommands) {
  check(`lib.rs registers ${name} (${section})`, libRs.includes(name));
}
if (libRs.includes('api_get_meetings_by_date_range')) {
  violations.push(
    'VIOLATION §3.1: lib.rs registers api_get_meetings_by_date_range — canonical name is api_get_meetings_by_range',
  );
}

/* ── §8: api_process_transcript must accept context_id ── */
check(
  'summary/commands.rs: api_process_transcript accepts context_id (§8.1)',
  /api_process_transcript[\s\S]{0,400}context_id/.test(summaryCommands),
);

/* ── §4.2: frontend template service calls canonical commands ── */
const templateInvocations = [...templateService.matchAll(/invoke<[^>]*>\('([a-z_0-9]+)'/g)].map((m) => m[1]);
  const canonicalTemplate = new Set([
    'api_list_templates',
    'api_get_template_json',
    'api_validate_template',
    'api_create_custom_template',
    'api_update_custom_template',
    'api_delete_custom_template',
    'api_duplicate_template',
    'api_get_default_template',
    'api_set_default_template',
  ]);
for (const cmd of templateInvocations) {
  check(`templateService invokes canonical command ${cmd}`, canonicalTemplate.has(cmd));
}

/* ── §5.2: frontend daily service calls canonical daily-summary commands ── */
for (const cmd of ['api_generate_daily_summary', 'api_get_daily_summary', 'api_cancel_daily_summary']) {
  check(`dailyService invokes canonical command ${cmd}`, dailyService.includes(cmd));
}
for (const drifted of ['api_generate_daily_brief', 'api_get_daily_brief', 'api_cancel_daily_brief']) {
  if (dailyService.includes(drifted)) {
    violations.push(
      `VIOLATION §5.2: dailyService invokes '${drifted}' — canonical name differs (api_generate_daily_summary / api_get_daily_summary / api_cancel_daily_summary)`,
    );
  }
}

/* ── §3.1: meetingService canonical range command ── */
check('meetingService invokes api_get_meetings_by_range', meetingService.includes('api_get_meetings_by_range'));
if (meetingService.includes('api_get_meetings_by_date_range')) {
  violations.push(
    'VIOLATION §3.1: meetingService invokes api_get_meetings_by_date_range — canonical name is api_get_meetings_by_range',
  );
}

/* ── §3.2/§3.3: calendar range SQL rules ── */
check(
  'calendar range SQL orders by normalized datetime(created_at) (§3.2)',
  /ORDER BY\s+datetime\(m\.created_at\)/i.test(meetingRepo),
);
check(
  'calendar range SQL filters via datetime() normalization (§3.2)',
  /datetime\(m\.created_at\)\s*>=\s*datetime\(\?/.test(meetingRepo) && /datetime\(m\.created_at\)\s*<\s*datetime\(\?/.test(meetingRepo),
);
check(
  'calendar duration derivation follows §3.3 (MAX(audio_end_time)>0 else SUM(duration) else None)',
  !meetingRepo.includes('MAX(t.audio_end_time)') ||
    /audio_end_time[\s\S]{0,80}>\s*0/.test(meetingRepo) && /SUM\(t\.duration\)/.test(meetingRepo),
);

/* ── §2.7: no auth_token in new commands ── */
const rangeCmdBlock = apiRs.match(/api_get_meetings_by_date_range[\s\S]{0,600}/)?.[0] ?? '';
check(
  'calendar range command has no auth_token param (§2.7)',
  !/auth_token/.test(rangeCmdBlock),
);

/* ── §9: meeting delete cleans context links, memory items, daily summaries ── */
for (const table of ['context_meetings', 'context_memory_items', 'daily_summaries']) {
  check(`meeting delete transaction cleans ${table} (§9)`, meetingRepo.includes(table));
}

/* ── §11: FK pragma in DatabaseManager ── */
check('DatabaseManager enables foreign_keys pragma (§11)', /foreign_keys["']?\s*,\s*["']ON/i.test(managerRs));

/* ── §5.2: daily_brief bundled template ── */
const briefPath = path.join(frontendRoot, 'src-tauri', 'templates', 'daily_brief.json');
const briefRaw = readIf(briefPath);
if (briefRaw === null) {
  violations.push('VIOLATION §5.2: bundled template src-tauri/templates/daily_brief.json is missing');
} else {
  try {
    const brief = JSON.parse(briefRaw);
    const okShape =
      typeof brief.name === 'string' &&
      brief.name.trim().length > 0 &&
      typeof brief.description === 'string' &&
      brief.description.trim().length > 0 &&
      Array.isArray(brief.sections) &&
      brief.sections.length > 0 &&
      brief.sections.every(
        (s) =>
          s &&
          typeof s.title === 'string' &&
          s.title.trim().length > 0 &&
          typeof s.instruction === 'string' &&
          s.instruction.trim().length > 0 &&
          ['paragraph', 'list', 'string'].includes(s.format),
      );
    check('daily_brief.json validates against Template schema (§5.2)', okShape);
  } catch {
    violations.push('VIOLATION §5.2: daily_brief.json is not valid JSON');
  }
}

/* ── §12: routes present ── */
for (const route of ['calendar', 'daily', 'context']) {
  check(`route /${route} exists`, fs.existsSync(path.join(frontendRoot, 'src', 'app', route, 'page.tsx')));
}

/* ── Export-safe routing for runtime entities (§routing) ──
 * The app ships as a static export. Runtime-created entities (contexts,
 * meetings, notes) must be addressed by QUERY parameters on static routes —
 * never by dynamic path segments, which crash with "missing param in
 * generateStaticParams" for any id created after the build. ── */
check(
  'routing: no /context/[id] dynamic segment',
  !fs.existsSync(path.join(frontendRoot, 'src', 'app', 'context', '[id]', 'page.tsx')),
);
check(
  'routing: no /notes/[id] dynamic segment',
  !fs.existsSync(path.join(frontendRoot, 'src', 'app', 'notes', '[id]', 'page.tsx')),
);
const routesLib = readIf(path.join(frontendRoot, 'src', 'lib', 'routes.ts')) ?? '';
check(
  'routing: canonical helpers build query-param URLs for runtime ids',
  routesLib.includes('withQuery(\'/context\'') && routesLib.includes('withQuery(\'/meeting-details\'') && routesLib.includes('withQuery(\'/notes\''),
);
check(
  'routing: context helper targets /context?id=',
  /context:[\s\S]{0,120}withQuery\('\/context', \{ id: contextId \}\)/.test(routesLib),
);
for (const comp of ['Calendar', 'DailyMeeting', 'Context', 'templates']) {
  check(`components/${comp}/ exists`, fs.existsSync(path.join(frontendRoot, 'src', 'components', comp)));
}

/* ── §12 ownership: calendar command lives in api/api.rs (owner-owned) ── */
if (apiRs.includes('api_get_meetings_by_date_range')) {
  info(
    'ownership',
    'calendar range command landed in api/api.rs (owner-owned per §12); contract places agent code in api/calendar.rs',
  );
}

/* ── report ── */
console.log('');
console.log(`Contract audit: ${passCount} passed, ${violations.length} violations, ${notes.length} notes`);
for (const v of violations) console.log(`  ${v}`);
for (const n of notes) console.log(`  ${n}`);
if (violations.length > 0) {
  console.log('');
  console.log(
    'Binding violations are expected mid-integration; they flip green as the Integration Owner reconciles per §1.1.',
  );
}
process.exit(Math.min(violations.length, 255));
