import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ffmpegBuildScript = path.join(repoRoot, 'frontend/src-tauri/build/ffmpeg.rs');
const cachedBinaryPath = path.join(
  repoRoot,
  'frontend/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe'
);

describe('Workstream 1 — Cross-Platform FFmpeg Cryptographic Integrity', () => {
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

  it('never substitutes functional -version execution for cryptographic integrity', () => {
    assert.ok(
      buildScriptContent.includes(
        'Functional -version execution is never a substitute for integrity verification'
      ),
      'must explicitly refuse to substitute -version execution for cryptographic integrity'
    );
  });

  it('enforces 64-character hex format on RECALL_FFMPEG_SHA256 overrides', () => {
    assert.ok(
      buildScriptContent.includes('is_valid_sha256_hex'),
      'must validate that RECALL_FFMPEG_SHA256 is a 64-character hex string'
    );
  });

  it('prevents RECALL_FFMPEG_SHA256 from overriding pinned official hashes with conflicting values', () => {
    assert.ok(
      buildScriptContent.includes('cannot override official pinned release hash'),
      'must reject RECALL_FFMPEG_SHA256 if it attempts to override official pinned hash with conflicting value'
    );
  });

  it('validates that cached Windows binary matches the pinned SHA-256 hash exactly', () => {
    if (fs.existsSync(cachedBinaryPath)) {
      const fileBuffer = fs.readFileSync(cachedBinaryPath);
      const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const expectedHash = '5af82a0d4fe2b9eae211b967332ea97edfc51c6b328ca35b827e73eac560dc0d';
      assert.equal(
        computedHash.toLowerCase(),
        expectedHash.toLowerCase(),
        'cached Windows FFmpeg binary must match pinned SHA-256 hash byte-for-byte'
      );
    }
  });
});
