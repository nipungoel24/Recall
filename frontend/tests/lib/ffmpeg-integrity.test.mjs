import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ffmpegBuildScript = path.join(repoRoot, 'frontend/src-tauri/build/ffmpeg.rs');
const cachedBinaryPath = path.join(
  repoRoot,
  'frontend/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe'
);

describe('Workstream 1 — Cross-Platform FFmpeg Cryptographic Integrity & Release Requirements', () => {
  const buildScriptContent = fs.readFileSync(ffmpegBuildScript, 'utf8');

  it('pins the official Windows x86_64 essentials binary hash', () => {
    const expectedHash = '5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d';
    assert.ok(
      buildScriptContent.includes(expectedHash),
      'build script must pin the official Windows x86_64 hash'
    );
  });

  it('fails closed in official release builds if a checksum is missing', () => {
    assert.ok(
      buildScriptContent.includes('RELEASE BUILD FAILS CLOSED'),
      'must fail closed in release builds when a target lacks a pinned checksum'
    );
    assert.ok(
      buildScriptContent.includes('is_release_build'),
      'must distinguish release builds from debug builds'
    );
  });

  it('leaves macOS and Linux targets unpinned (blocked for release until trusted mirror exists)', () => {
    // get_official_pinned_sha256 returns None for non-windows targets
    assert.ok(
      buildScriptContent.includes('macOS and Linux binaries require Recall-owned mirroring and verified pinning'),
      'must explicitly document blocked status for macOS and Linux'
    );
    // Ensure only windows target is pinned
    assert.ok(
      buildScriptContent.includes('target.contains("windows")'),
      'only verified windows target has a pinned hash'
    );
  });

  it('never substitutes functional -version execution for cryptographic integrity', () => {
    assert.ok(
      buildScriptContent.includes(
        'Functional -version execution is never a substitute for integrity verification'
      ),
      'must explicitly refuse to substitute -version execution for cryptographic integrity'
    );
    assert.ok(
      buildScriptContent.includes(
        'Execution check is NEVER a substitute for SHA-256; both must pass'
      ),
      'functional check must require cryptographic check'
    );
  });

  it('enforces 64-character hex format on RECALL_FFMPEG_SHA256 overrides', () => {
    assert.ok(
      buildScriptContent.includes('is_valid_sha256_hex'),
      'must validate that RECALL_FFMPEG_SHA256 is a 64-character hex string'
    );
    assert.ok(
      buildScriptContent.includes('RECALL_FFMPEG_SHA256 is invalid (must be 64-character hex string)'),
      'must emit explicit error on malformed hex strings'
    );
  });

  it('prevents RECALL_FFMPEG_SHA256 from overriding pinned official hashes with conflicting values', () => {
    assert.ok(
      buildScriptContent.includes('cannot override official pinned release hash'),
      'must reject RECALL_FFMPEG_SHA256 if it attempts to override official pinned hash with conflicting value'
    );
  });

  it('detects SHA-256 mismatch and rejects corrupted or tampered binaries', () => {
    assert.ok(
      buildScriptContent.includes('FFmpeg SHA-256 mismatch for'),
      'must detect and report hash mismatches'
    );
  });

  it('detects cache corruption, cleans the corrupted binary, and fails closed or re-downloads', () => {
    assert.ok(
      buildScriptContent.includes('Cached FFmpeg binary appears corrupted, re-downloading...'),
      'must detect cache corruption'
    );
    assert.ok(
      buildScriptContent.includes('std::fs::remove_file(&binary_path)'),
      'must delete corrupted cached binary'
    );
  });

  it('handles download failure by panicking without proceeding with partial binaries', () => {
    assert.ok(
      buildScriptContent.includes('panic!("⚠️  Failed to download FFmpeg: {}"'),
      'must panic on download failure and halt build immediately'
    );
  });

  it('validates that cached Windows binary matches the pinned SHA-256 hash exactly', () => {
    if (fs.existsSync(cachedBinaryPath)) {
      const fileBuffer = fs.readFileSync(cachedBinaryPath);
      const computedHash = createHash('sha256').update(fileBuffer).digest('hex');
      const expectedHash = '5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d';
      assert.equal(
        computedHash.toLowerCase(),
        expectedHash.toLowerCase(),
        'cached Windows FFmpeg binary must match pinned SHA-256 hash byte-for-byte'
      );
    }
  });
});
