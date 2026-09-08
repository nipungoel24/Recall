/**
 * Recall updater regression gate.
 *
 * Runnable with:  node --test tests/lib/updater-regression.test.mjs
 *
 * Phase 1 decision: automatic application updating is DISABLED until Recall
 * has its own release infrastructure, signing keys, updater artifacts, and
 * verified upgrade testing. The historical Meetily/upstream release feed
 * must never be contacted by a running Recall app.
 *
 * This gate fails if any of the removed updater wiring is reintroduced:
 *   - Tauri updater plugin config (endpoints / pubkey) in tauri.conf.json
 *   - updater artifacts generation
 *   - tauri-plugin-updater / tauri-plugin-process in the Rust manifest
 *   - updater/process plugin registration in Rust sources
 *   - @tauri-apps/plugin-updater / @tauri-apps/plugin-process in package.json
 *   - updater imports, update-check UI glue, or tray update events in
 *     frontend sources
 *   - the historical upstream release feed in any active runtime surface
 *
 * The repo-root product docs (PRD.md, Architecture.md, Phases.md, Memory.md,
 * README.md, docs/, archived backend/) may legitimately name the historical
 * upstream repository for attribution/history; they are not scanned here.
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

const HISTORICAL_UPSTREAM_REPO = 'Zackriya-Solutions/meeting-minutes';
const HISTORICAL_UPDATE_ENDPOINT =
  'Zackriya-Solutions/meeting-minutes/releases/latest/download/latest.json';

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|rs|json|toml|yml|yaml|ps1|bat|sh)$/;

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

describe('Recall updater regression gate', () => {
  test('tauri.conf.json carries no updater plugin configuration', () => {
    const confPath = path.join(tauriRoot, 'tauri.conf.json');
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    assert.equal(
      conf.plugins && conf.plugins.updater,
      undefined,
      'plugins.updater must be absent from tauri.conf.json (no endpoints, no pubkey)',
    );
    assert.notEqual(
      conf.bundle && conf.bundle.createUpdaterArtifacts,
      true,
      'bundle.createUpdaterArtifacts must not be enabled while the updater is disabled',
    );
    const raw = JSON.stringify(conf);
    assert.ok(
      !/"updater:[a-z-]+"/.test(raw) && !/"process:[a-z-]+"/.test(raw),
      'updater:/process: capabilities must be absent from tauri.conf.json',
    );
  });

  test('Rust manifests contain no updater/process plugin dependencies', () => {
    const cargoToml = readFileIfExists(path.join(tauriRoot, 'Cargo.toml')) || '';
    assert.ok(
      !cargoToml.includes('tauri-plugin-updater'),
      'tauri-plugin-updater must not be a dependency',
    );
    assert.ok(
      !cargoToml.includes('tauri-plugin-process'),
      'tauri-plugin-process must not be a dependency (used only for updater relaunch)',
    );
  });

  test('Rust sources register no updater/process plugins', () => {
    const srcFiles = collectFiles(path.join(tauriRoot, 'src'));
    assert.ok(srcFiles.length > 0, 'expected Rust sources to exist');
    const offenders = [];
    for (const file of srcFiles) {
      const content = readFileIfExists(file) || '';
      for (const [i, line] of content.split('\n').entries()) {
        if (line.includes('tauri_plugin_updater') || line.includes('tauri_plugin_process')) {
          offenders.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, [], 'no Rust source may register the updater/process plugins');
  });

  test('frontend package.json contains no updater/process plugin packages', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    assert.ok(!('@tauri-apps/plugin-updater' in deps), '@tauri-apps/plugin-updater must be removed');
    assert.ok(!('@tauri-apps/plugin-process' in deps), '@tauri-apps/plugin-process must be removed');
  });

  test('frontend sources contain no updater wiring', () => {
    const srcFiles = collectFiles(path.join(frontendRoot, 'src'));
    assert.ok(srcFiles.length > 0, 'expected frontend sources to exist');
    const offenders = [];
    const patterns = [
      '@tauri-apps/plugin-updater',
      '@tauri-apps/plugin-process',
      'check-updates-from-tray',
      '@/services/updateService',
    ];
    for (const file of srcFiles) {
      const content = readFileIfExists(file) || '';
      for (const [i, line] of content.split('\n').entries()) {
        for (const pattern of patterns) {
          if (line.includes(pattern)) {
            offenders.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'no frontend source may wire the removed updater');
  });

  test('historical upstream release feed is absent from active runtime surfaces', () => {
    const surfaces = [
      path.join(frontendRoot, 'src'),
      path.join(tauriRoot, 'src'),
      path.join(tauriRoot, 'tauri.conf.json'),
      path.join(tauriRoot, 'Cargo.toml'),
      path.join(tauriRoot, 'build.rs'),
      path.join(frontendRoot, 'package.json'),
      path.join(repoRoot, 'scripts'),
      path.join(repoRoot, '.github', 'workflows'),
    ];
    const offenders = [];
    for (const surface of surfaces) {
      const files = fs.existsSync(surface) && fs.statSync(surface).isDirectory() ? collectFiles(surface) : [surface];
      for (const file of files) {
        const content = readFileIfExists(file) || '';
        for (const [i, line] of content.split('\n').entries()) {
          if (line.includes(HISTORICAL_UPSTREAM_REPO) || line.includes(HISTORICAL_UPDATE_ENDPOINT)) {
            offenders.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `historical upstream release feed (${HISTORICAL_UPSTREAM_REPO}) must not appear in active surfaces`,
    );
  });
});
