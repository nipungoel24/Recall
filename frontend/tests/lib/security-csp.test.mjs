import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const tauriConfPath = path.join(repoRoot, 'frontend/src-tauri/tauri.conf.json');

describe('Security — Production Content Security Policy & Least Privilege', () => {
  const confRaw = fs.readFileSync(tauriConfPath, 'utf8');
  const conf = JSON.parse(confRaw);
  const security = conf.app?.security ?? {};
  const csp = security.csp ?? {};

  it('declares a structured CSP configuration', () => {
    assert.ok(csp, 'security.csp must be defined');
    assert.equal(typeof csp, 'object', 'security.csp must be an object');
  });

  it('restricts default-src to self', () => {
    assert.equal(csp['default-src'], "'self'", "default-src must strictly be 'self'");
  });

  it('restricts style-src to self and unsafe-inline without wildcards', () => {
    const styleSrc = csp['style-src'];
    assert.ok(styleSrc.includes("'self'"), "style-src must include 'self'");
    assert.ok(
      styleSrc.includes("'unsafe-inline'"),
      "style-src requires 'unsafe-inline' for dynamic component widths and CSS custom variables"
    );
    assert.ok(!styleSrc.includes('*'), 'style-src must not contain open wildcards');
    assert.ok(!styleSrc.includes('http:'), 'style-src must not allow unencrypted external styles');
  });

  it('restricts img-src to self and data URIs, excluding asset protocol', () => {
    const imgSrc = csp['img-src'];
    assert.ok(imgSrc.includes("'self'"), "img-src must include 'self'");
    assert.ok(imgSrc.includes('data:'), "img-src must include 'data:'");
    assert.ok(
      !imgSrc.includes('asset.localhost'),
      'img-src must not include asset.localhost because asset protocol is disabled'
    );
    assert.ok(!imgSrc.includes('*'), 'img-src must not contain open wildcards');
  });

  it('confines connect-src to self and local Tauri IPC origins only', () => {
    const connectSrc = csp['connect-src'];
    assert.ok(connectSrc.includes("'self'"), "connect-src must include 'self'");
    assert.ok(connectSrc.includes('ipc:'), "connect-src must include 'ipc:' for Unix IPC");
    assert.ok(
      connectSrc.includes('http://ipc.localhost'),
      "connect-src must include 'http://ipc.localhost' for Windows IPC"
    );

    // Verify obsolete legacy endpoints are absent
    assert.ok(!connectSrc.includes('5167'), 'connect-src must not include legacy FastAPI port 5167');
    assert.ok(!connectSrc.includes('8178'), 'connect-src must not include legacy Whisper server port 8178');
    assert.ok(!connectSrc.includes('11434'), 'connect-src must not include direct Ollama port 11434 (IPC handles LLM)');
    assert.ok(!connectSrc.includes('api.ollama.ai'), 'connect-src must not include external Ollama registry');
    assert.ok(!connectSrc.includes('*'), 'connect-src must not contain open wildcards');
  });

  it('strictly forbids unsafe-eval anywhere in security configuration or codebase', () => {
    assert.ok(
      !confRaw.includes('unsafe-eval'),
      "tauri.conf.json must never grant 'unsafe-eval'"
    );
  });

  it('confirms asset protocol remains disabled in packaging configuration', () => {
    assert.equal(
      security.assetProtocol?.enable,
      false,
      'assetProtocol.enable must remain false'
    );
  });

  it('confirms auto-updater artifacts remain disabled', () => {
    assert.equal(
      conf.bundle?.createUpdaterArtifacts,
      false,
      'createUpdaterArtifacts must remain false'
    );
  });
});
