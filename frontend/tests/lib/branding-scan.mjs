/**
 * Recall branding forensic scanner (shared implementation).
 *
 * The product was renamed Meetily -> Recall. The old name may only survive in
 * places where it is INTENTIONAL, and the gate has to tell those apart from
 * genuine brand leakage. A naive "repo contains no meetily" rule would be
 * wrong: it would forbid the app-data identifier and the legacy data paths
 * that keep real users' data reachable.
 *
 * Categories of tolerated reference:
 *   MIGRATION_COMPAT   legacy data paths, env fallbacks, old DB / store names
 *   LEGAL_ATTRIBUTION  MIT copyright + origin statement
 *   UPSTREAM_HISTORY   applied migrations, archived backend, upstream repo refs
 *
 * Everything else on a production surface is a BUG.
 *
 * This module is runner-agnostic so the same rules execute under `node --test`
 * and under `bun test`. The previous gate was Bun-only, which meant it silently
 * never ran on the Windows CLI host.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Old brand tokens that must not appear on a production surface. */
export const BRAND_PATTERN = /Meetily|meetily|MEETILY|Zackriya|zackriya/g

/** Vendor marketing domains that must never be linked from the product. */
export const VENDOR_URL_PATTERN =
  /https?:\/\/[^\s'"`)]*(?:zackriya|meetily)[^\s'"`)]*/g

export const ALLOWLIST = [
  // ── Rust compatibility layer (the migration contract itself) ──
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'compat module documents legacy names' },
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy dir/env constants + tests' },
  { fileContains: 'src-tauri/src/brand_paths.rs', lineContains: 'MEETILY_', classification: 'MIGRATION_COMPAT', reason: 'legacy env fallback in tests' },
  { fileContains: 'summary/templates/loader.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'custom-templates fallback comment' },
  { fileContains: 'summary/templates/mod.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'custom-templates fallback comment' },
  { fileContains: 'audio/recording_preferences.rs', lineContains: 'meetily-recordings', classification: 'MIGRATION_COMPAT', reason: 'legacy recordings folder fallback' },
  { fileContains: 'notifications/settings.rs', lineContains: 'meetily/', classification: 'MIGRATION_COMPAT', reason: 'legacy notification settings fallback' },
  { fileContains: 'parakeet_engine/parakeet_engine.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'summary/summary_engine/model_manager.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'whisper_engine/whisper_engine.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy models folder fallback' },
  { fileContains: 'summary/summary_engine/sidecar.rs', lineContains: 'MEETILY_LLAMA_HELPER', classification: 'MIGRATION_COMPAT', reason: 'legacy env var fallback' },
  { fileContains: 'parakeet_engine/parakeet_engine.rs', lineContains: 'meetily.towardsgeneralintelligence.com', classification: 'MIGRATION_COMPAT', reason: 'external model URL (third-party host)' },
  { fileContains: 'src-tauri/tauri.conf.json', lineContains: 'com.meetily.ai', classification: 'MIGRATION_COMPAT', reason: 'preserved app-data identifier (user data safety)' },
  { fileContains: '.github/workflows/', lineContains: 'MEETILY_RSA_PUBLIC_KEY', classification: 'MIGRATION_COMPAT', reason: 'existing secret name; rotate deliberately, not by rename' },
  { fileContains: 'frontend/build.ps1', lineContains: 'meetily.key', classification: 'MIGRATION_COMPAT', reason: 'existing signing key filename' },
  { fileContains: 'src-tauri/migrations/', lineContains: 'MEETILY_', classification: 'UPSTREAM_HISTORY', reason: 'applied SQL migration comments are checksum-sensitive; never edit' },
  { fileContains: 'scripts/inject_transcript.py', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'dev script probes legacy + current data dirs' },
  { fileContains: 'scripts/inject_transcript.py', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'dev script probes legacy + current data dirs' },
  { fileContains: 'qa/rust-regression/src/loader_stub.rs', lineContains: 'MEETILY_QA_TEMPLATES_DIR', classification: 'MIGRATION_COMPAT', reason: 'legacy env fallback in QA harness' },
  { fileContains: 'qa/rust-regression/src/loader_stub.rs', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy templates dir fallback in QA harness' },

  // ── Upstream history referenced as a NEGATIVE assertion ──
  // The updater gate proves the old upstream release feed is never consumed
  // again, so it must name the retired repo. Referencing it is the assertion.
  { fileContains: 'tests/lib/updater-regression.test.mjs', lineContains: 'Meetily', classification: 'UPSTREAM_HISTORY', reason: 'asserts the historical upstream release feed stays unused' },
  { fileContains: 'tests/lib/updater-regression.test.mjs', lineContains: 'Zackriya-Solutions/meeting-minutes', classification: 'UPSTREAM_HISTORY', reason: 'retired upstream repo named as a negative assertion' },

  // ── Frontend legacy-data handling (paths + store names only) ──
  { fileContains: 'src/contexts/OnboardingContext.tsx', lineContains: 'meetily', classification: 'MIGRATION_COMPAT', reason: 'legacy Homebrew DB detection path' },
  { fileContains: 'src/contexts/OnboardingContext.tsx', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'comment explaining legacy detection' },
  { fileContains: 'src/services/indexedDBService.ts', lineContains: 'Meetily', classification: 'MIGRATION_COMPAT', reason: 'one-time recovery-DB migration from legacy store name' },
  { fileContains: 'src/components/DatabaseImport/HomebrewDatabaseDetector.tsx', lineContains: 'meetily/meeting_minutes.db', classification: 'MIGRATION_COMPAT', reason: 'legacy install detection paths' },

  // ── Legal attribution (MIT requires the notice to travel with the code) ──
  { fileContains: 'src/components/About.tsx', lineContains: 'derived from the Meetily', classification: 'LEGAL_ATTRIBUTION', reason: 'MIT origin statement' },
  { fileContains: 'src/components/About.tsx', lineContains: 'Zackriya Solutions', classification: 'LEGAL_ATTRIBUTION', reason: 'MIT copyright notice' },
]

/** Production branding surfaces scanned by this gate. */
export const SCAN_SUBTREES = [
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
]

/** Text file extensions the text scan understands. */
const TEXT_EXT =
  /\.(ts|tsx|js|mjs|cjs|rs|json|json5|yml|yaml|toml|md|ps1|bat|sh|py|sql)$/

/** Directories never worth walking. */
const SKIP_DIRS = new Set(['node_modules', 'target', '.next', 'out', '.git'])

/**
 * SHA-256 of the retired Meetily brand assets.
 *
 * A text scan cannot see a PNG. Pinning the digests of the assets we replaced
 * means a well-meaning revert of logo.png / the Tauri icon set is caught, which
 * is exactly the gap that let the Meetily mascot ship inside the collapsed
 * sidebar and the About dialog.
 */
export const RETIRED_BRAND_ASSET_SHA256 = new Set([
  '5c1f594e154f2c53ff11c198be8067ae501b1ed7e4f2f14412334af62c148216', // public/logo.png
  'b24939932ef01a47f71026a2c840858d566b1068544008fa8ab5e1488a74b366', // public/logo-collapsed.png
  '96a6857e9539be91c832ef643d65a4550c7c25ba38c44bf3b7b083f7be4c5b1a', // public/icon_128x128.png
  '28f4796d1a3ec5fa57b30c09047b74262dd5851f0a0a339fee78dd70086cb647', // src-tauri/icons/128x128.png
  '092388f74d10230fbb270e2006f5dd067a3f83c347dfbff888a2179f618c9ac7', // src-tauri/icons/icon.ico
  '8f7a466bd486accffa8098f9daa201784e0046d29862654f9fb76a5db40c6e31', // src-tauri/icons/app_icon.ico
])

/** Directories whose binary contents are brand assets. */
export const BRAND_ASSET_DIRS = [
  'frontend/public',
  'frontend/src-tauri/icons',
]

const IMAGE_EXT = /\.(png|ico|icns|jpg|jpeg|webp|gif|svg)$/i

export function collectFiles(entry, out, filter = () => true) {
  let stat
  try {
    stat = fs.statSync(entry)
  } catch {
    return
  }
  if (stat.isFile()) {
    if (filter(entry)) out.push(entry)
    return
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      if (SKIP_DIRS.has(child)) continue
      collectFiles(path.join(entry, child), out, filter)
    }
  }
}

function isAllowed(relPath, line) {
  const normalized = relPath.split(path.sep).join('/')
  // The gate itself necessarily names the old brand in its allowlist, its
  // denylist digests and its test titles. Other gates that assert the brand's
  // *absence* must name it too. Keep this list explicit: widening it to "any
  // test file" would let a real leak hide behind a test.
  if (/tests\/lib\/(?:branding-(?:scan|regression)(?:\.test)?|sidebar-polish\.test)\.(mjs|ts)$/.test(normalized)) {
    return true
  }
  return ALLOWLIST.some(
    (rule) => normalized.includes(rule.fileContains) && line.includes(rule.lineContains),
  )
}

/** Old-brand text found on production surfaces outside the allowlist. */
export function scanText(repoRoot) {
  const files = []
  for (const subtree of SCAN_SUBTREES) {
    collectFiles(path.join(repoRoot, subtree), files, (f) => TEXT_EXT.test(f))
  }
  const violations = []
  for (const file of files) {
    const rel = path.relative(repoRoot, file)
    let content
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    content.split('\n').forEach((text, index) => {
      BRAND_PATTERN.lastIndex = 0
      if (!BRAND_PATTERN.test(text)) return
      if (!isAllowed(rel, text)) {
        violations.push({ file: rel, line: index + 1, text: text.trim().slice(0, 160) })
      }
    })
  }
  return { filesScanned: files.length, violations }
}

/** Links to the old vendor's website from product source. */
export function scanVendorUrls(repoRoot) {
  const files = []
  collectFiles(path.join(repoRoot, 'frontend/src'), files, (f) => TEXT_EXT.test(f))
  const violations = []
  for (const file of files) {
    const rel = path.relative(repoRoot, file)
    const content = fs.readFileSync(file, 'utf8')
    content.split('\n').forEach((text, index) => {
      VENDOR_URL_PATTERN.lastIndex = 0
      const match = VENDOR_URL_PATTERN.exec(text)
      if (match) {
        violations.push({ file: rel, line: index + 1, url: match[0] })
      }
    })
  }
  return violations
}

/** Retired Meetily image assets still present in the brand asset folders. */
export function scanBrandAssets(repoRoot) {
  const violations = []
  let scanned = 0
  for (const dir of BRAND_ASSET_DIRS) {
    const files = []
    collectFiles(path.join(repoRoot, dir), files, (f) => IMAGE_EXT.test(f))
    for (const file of files) {
      scanned += 1
      const buf = fs.readFileSync(file)
      const digest = sha256(buf)
      if (RETIRED_BRAND_ASSET_SHA256.has(digest)) {
        violations.push({ file: path.relative(repoRoot, file), sha256: digest })
      }
    }
  }
  return { assetsScanned: scanned, violations }
}

import { createHash } from 'node:crypto'
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Marketing furniture that must not reappear in the About panel. */
export const ABOUT_MARKETING_PATTERNS = [
  /chat with/i,
  /built by/i,
  /zackriya team/i,
  /coming soon/i,
  /ready to push/i,
  /talk to sales/i,
  /book a demo/i,
]

export function scanAboutPanel(repoRoot) {
  const file = path.join(repoRoot, 'frontend/src/components/About.tsx')
  const content = fs.readFileSync(file, 'utf8')
  const violations = []
  for (const pattern of ABOUT_MARKETING_PATTERNS) {
    if (pattern.test(content)) {
      violations.push({ file: 'frontend/src/components/About.tsx', pattern: String(pattern) })
    }
  }
  return violations
}
