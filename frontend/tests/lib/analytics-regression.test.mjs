/**
 * Recall telemetry regression gate.
 *
 * Runnable with:  node --test tests/lib/analytics-regression.test.mjs
 *
 * Phase 1 product decision: Recall has NO external product analytics
 * telemetry at this stage. The inherited PostHog integration (upstream API
 * key, posthog-rs client, analytics Tauri commands, frontend analytics
 * facade, consent UI) was removed. Local application logs are unaffected.
 *
 * This gate fails if any of the removed telemetry wiring is reintroduced:
 *   - posthog-rs in the Rust manifest
 *   - PostHog hosts or the inherited API key anywhere in active surfaces
 *   - analytics Tauri command names (init_analytics, track_event, ...)
 *   - an analytics facade or consent UI in frontend sources
 *   - analytics.json store usage in frontend sources
 *
 * The repo-root product docs (PRD.md, Privacy policy, Architecture.md,
 * Phases.md, Memory.md, README.md, docs/) may name PostHog for historical
 * documentation; they are not scanned here. The archived backend/ subtree
 * is excluded for the same reason.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const tauriRoot = path.join(frontendRoot, 'src-tauri');

const INHERITED_POSTHOG_KEY = 'phc_Aa9PqeCkDkVbtbRsYjtmHANBfcscjCVupxZwrtL5vZ77';
const POSTHOG_HOSTS = ['us.i.posthog.com', 'app.posthog.com', 'eu.i.posthog.com'];
const ANALYTICS_COMMANDS = [
  'init_analytics',
  'disable_analytics',
  'track_event',
  'identify_user',
  'track_meeting_started',
  'track_recording_started',
  'track_recording_stopped',
  'track_meeting_deleted',
  'track_settings_changed',
  'track_feature_used',
  'is_analytics_enabled',
  'start_analytics_session',
  'end_analytics_session',
  'track_daily_active_user',
  'track_user_first_launch',
  'is_analytics_session_active',
  'track_summary_generation_started',
  'track_summary_generation_completed',
  'track_summary_regenerated',
  'track_model_changed',
  'track_custom_prompt_used',
  'track_meeting_ended',
  'track_analytics_enabled',
  'track_analytics_disabled',
  'track_analytics_transparency_viewed',
];

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|rs|json|toml|yml|yaml)$/;

function collectFiles(entry, out = []) {
  let stat;
  try {
    stat = fs.statSync(entry);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (SCANNED_EXTENSIONS.test(entry)) out.push(entry);
    return out;
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      if (child === 'node_modules' || child === 'target' || child === '.next' || child === 'out') {
        continue;
      }
      collectFiles(path.join(entry, child), out);
    }
  }
  return out;
}

function readFileIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function findViolations(files, needles, label) {
  const offenders = [];
  for (const file of files) {
    const content = readFileIfExists(file) || '';
    const lines = content.split('\n');
    for (const [i, line] of lines.entries()) {
      for (const needle of needles) {
        if (line.includes(needle)) {
          offenders.push(
            `${label}: ${path.relative(repoRoot, file)}:${i + 1}: ${line.trim().slice(0, 160)}`,
          );
        }
      }
    }
  }
  return offenders;
}

describe('Recall telemetry regression gate', () => {
  const rustManifest = readFileIfExists(path.join(tauriRoot, 'Cargo.toml')) || '';
  const frontendPkg = JSON.parse(readFileIfExists(path.join(frontendRoot, 'package.json')) || '{}');
  const rustSources = collectFiles(path.join(tauriRoot, 'src'));
  const frontendSources = collectFiles(path.join(frontendRoot, 'src'));
  const tauriConf = readFileIfExists(path.join(tauriRoot, 'tauri.conf.json')) || '';

  test('posthog-rs dependency is absent from the Rust manifest', () => {
    assert.ok(!rustManifest.includes('posthog-rs'), 'posthog-rs must not be a dependency');
  });

  test('inherited PostHog key and hosts are absent from active surfaces', () => {
    const offenders = findViolations(
      [...rustSources, ...frontendSources, path.join(tauriRoot, 'Cargo.toml'), path.join(tauriRoot, 'tauri.conf.json'), path.join(frontendRoot, 'package.json')],
      [INHERITED_POSTHOG_KEY, ...POSTHOG_HOSTS, 'posthog'],
      'posthog',
    );
    assert.deepEqual(offenders, [], 'no PostHog host/key may reappear in active code or config');
  });

  test('analytics Tauri commands are absent from Rust sources', () => {
    const offenders = findViolations(rustSources, ANALYTICS_COMMANDS, 'command');
    assert.deepEqual(offenders, [], 'no analytics command may be re-registered');
  });

  test('no analytics facade, consent UI, or store usage in frontend sources', () => {
    const offenders = findViolations(
      frontendSources,
      ['analytics.json', 'AnalyticsConsentSwitch', 'AnalyticsDataModal', 'AnalyticsProvider', '@/lib/analytics'],
      'frontend',
    );
    assert.deepEqual(offenders, [], 'no frontend analytics wiring may be reintroduced');
  });

  test('tauri.conf.json exposes no analytics-related capabilities', () => {
    assert.ok(!/analytics/i.test(tauriConf), 'tauri.conf.json must not mention analytics');
  });
});
