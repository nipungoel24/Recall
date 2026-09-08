import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Recall branding regression gate.
 *
 * The product was renamed from Meetily → Recall. User-facing branding must
 * say Recall; the old name may only survive where it is INTENTIONAL:
 *
 *   - MIGRATION_COMPAT: legacy data paths, env fallbacks, old DB names,
 *     updater/secret identifiers that must keep resolving old installs.
 *   - LEGAL_ATTRIBUTION: "derived from the Meetily open-source project",
 *     vendor contact links, preserved author/copyright lines.
 *   - UPSTREAM_HISTORY: references to the original repository, docs,
 *     archived backend, checksums of already-applied SQL migrations.
 *
 * The scan is anchored at the repository root and covers the production
 * branding surfaces (frontend sources, Tauri config, package metadata,
 * active docs, scripts, workflows). Anything else that shows up here is a
 * BUG — old product branding leaking into Recall.
 */

const repoRoot = path.resolve(import.meta.dir, '..', '..', '..');

interface AllowRule {
  /** substring that must appear in the file path (repo-relative, / separators) */
  fileContains: string;
  /** substring that must appear in the matching line */
  lineContains: string;
  classification: 'MIGRATION_COMPAT' | 'LEGAL_ATTRIBUTION' | 'UPSTREAM_HISTORY';
  reason: string;
}

const ALLOWLIST: AllowRule[] = [
  // ── Rust compatibility layer (the migration contract itself) ──
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'compat module documents legacy names' },
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy dir/env constants + tests' },
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'MEETILY_', classification: 'MIGRATION_COMPAT', reason: 'legacy env fallback in tests' },
  // Call-site comments that explain the fallback
  { fileContains: 'summary/templates/loader.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'custom-templates fallback comment' },
  { fileContains: 'summary/templates/mod.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'custom-templates fallback comment' },
  { fileContains: 'audio/recording_preferences.rs', lineContains: 'meetily-recordings', classification: 'MIGRATION_COMPAT', reason: 'legacy recordings folder fallback' },
  { fileContains: 'notifications/settings.rs', lineContains: 'meetily/', classification: 'MIGRATION_COMPAT', reason: 'legacy notification settings fallback' },
  { fileContains: 'parakeet_engine/parakeet_engine.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'summary/summary_engine/model_manager.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'whisper_engine/whisper_engine.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'summary/summary_engine/sidecar.rs', lineContains: 'MEETILY_LLAMA_HELPER', classification: 'MIGRATION_COMPAT', reason: 'legacy env var fallback' },
  // External model-download host: third-party contract, not our brand
  { fileContains: 'parakeet_engine/parakeet_engine.rs', lineContains: 'meetily.towardsgeneralintelligence.com', classification: 'MIGRATION_COMPAT', reason: 'external model URL (third-party host)' },
  // Tauri identifier deliberately preserved (no Recall data migration yet)
  { fileContains: 'src-tauri/tauri.conf.json', lineContains: 'com.meetily.ai', classification: 'MIGRATION_COMPAT', reason: 'preserved app-data identifier (user data safety)' },
  // Secrets must not be renamed casually
  { fileContains: '.github/workflows/', lineContains: 'MEETILY_RSA_PUBLIC_KEY', classification: 'MIGRATION_COMPAT', reason: 'existing secret name; rotate deliberately, not by rename' },
  // Signing-key filename referenced in build help text
  { fileContains: 'frontend/build.ps1', lineContains: 'meetily.key', classification: 'MIGRATION_COMPAT', reason: 'existing signing key filename' },
  // ── Frontend legacy-data handling ──
  { fileContains: 'src/contexts/OnboardingContext.tsx', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy Homebrew DB detection path' },
  { fileContains: 'src/contexts/OnboardingContext.tsx', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'comment explaining legacy detection' },
  { fileContains: 'src/services/indexedDBService.ts', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'one-time recovery-DB migration from legacy name' },
  { fileContains: 'src/components/DatabaseImport/HomebrewDatabaseDetector.tsx', lineContains: 'meetily/meeting_minutes.db', classification: 'MIGRATION_COMPAT', reason: 'legacy install detection paths' },
  { fileContains: 'src/components/DatabaseImport/LegacyDatabaseImport.tsx', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'tells users Recall reads Meetily-era databases' },
  { fileContains: 'src/components/DatabaseImport/HomebrewDatabaseDetector.tsx', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy-install import copy' },
  // ── Legal / attribution ──
  { fileContains: 'src/components/About.tsx', lineContains: 'meetily.zackriya.com', classification: 'LEGAL_ATTRIBUTION', reason: 'upstream vendor contact link preserved' },
  { fileContains: 'src/components/About.tsx', lineContains: 'derived from the Meetily', classification: 'LEGAL_ATTRIBUTION', reason: 'origin statement required by rebrand policy' },
  // ── Upstream history (docs, archive, applied migrations) ──
  { fileContains: 'src-tauri/migrations/', lineContains: 'MEETILY_', classification: 'UPSTREAM_HISTORY', reason: 'applied SQL migration comments are checksum-sensitive; never edit' },
  { fileContains: 'scripts/inject_transcript.py', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'dev script probes legacy + current data dirs' },
  { fileContains: 'scripts/inject_transcript.py', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'dev script probes legacy + current data dirs' },
  { fileContains: 'qa/rust-regression/src/loader_stub.rs', lineContains: 'MEETILY_QA_TEMPLATES_DIR', classification: 'MIGRATION_COMPAT', reason: 'legacy env fallback in QA harness' },
  { fileContains: 'qa/rust-regression/src/loader_stub.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy templates dir fallback in QA harness' },
];
// NOTE: Cargo.lock / pnpm-lock.yaml are intentionally NOT scanned — they
// regenerate deterministically from the manifests on the next cargo/pnpm run.
// Root/product docs (README, docs/, backend archive) are covered by the
// manual final-search classification in the rebrand report: they legitimately
// retain UPSTREAM_HISTORY / LEGAL_ATTRIBUTION references.

// Production branding surfaces scanned by this gate.
const SCAN_SUBTREES = [
  'frontend/src',
  'frontend/src-tauri/src',
  'frontend/src-tauri/tauri.conf.json',
  'frontend/src-tauri/Cargo.toml',
  'frontend/src-tauri/build.rs',
  'frontend/package.json',
  'frontend/tests',
  'frontend/scripts',
  'qa/rust-regression/src',
  'qa/rust-regression/tests',
  'qa/rust-regression/Cargo.toml',
  'scripts',
  '.github/workflows',
];

const BRAND_PATTERN = /Meetily|meetily|MEETILY/g;

interface Violation {
  file: string;
  line: number;
  text: string;
}

function collectFiles(entry: string, out: string[]): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(entry);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (/\.(ts|tsx|js|mjs|cjs|rs|json|json5|yml|yaml|toml|md|ps1|bat|sh|py|sql)$/.test(entry)) {
      out.push(entry);
    }
    return;
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      if (child === 'node_modules' || child === 'target' || child === '.next' || child === 'out') continue;
      collectFiles(path.join(entry, child), out);
    }
  }
}

function isAllowed(relPath: string, line: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  // The gate itself necessarily names the old brand in its allowlist and
  // documentation; never flag this file.
  if (normalized.endsWith('tests/lib/branding-regression.test.ts')) return true;
  return ALLOWLIST.some(
    (rule) => normalized.includes(rule.fileContains) && line.includes(rule.lineContains),
  );
}

describe('Recall branding regression gate', () => {
  test(
    'no accidental Meetily branding survives on production surfaces',
    () => {
    const files: string[] = [];
    for (const subtree of SCAN_SUBTREES) {
      collectFiles(path.join(repoRoot, subtree), files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: Violation[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      lines.forEach((text, index) => {
        BRAND_PATTERN.lastIndex = 0;
        if (!BRAND_PATTERN.test(text)) return;
        if (!isAllowed(rel, text)) {
          violations.push({ file: rel, line: index + 1, text: text.trim().slice(0, 160) });
        }
      });
    }

    if (violations.length > 0) {
      console.error(
        'Old-brand references outside the allowlist:\n' +
          violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n'),
      );
    }
    expect(violations).toEqual([]);
    },
    60000,
  );

  test('core product identity says Recall', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('recall');

    const tauriConf = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'frontend', 'src-tauri', 'tauri.conf.json'), 'utf8'),
    );
    expect(tauriConf.productName).toBe('Recall');
    // Identifier is deliberately preserved for user-data compatibility.
    expect(tauriConf.identifier).toBe('com.meetily.ai');
  });
});
