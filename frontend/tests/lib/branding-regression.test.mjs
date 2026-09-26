/**
 * Recall branding regression gate — Node runner.
 *
 * This is the entry point that actually executes on the Windows CLI host. The
 * historical `branding-regression.test.ts` imports from `bun:test`, so on a
 * machine without Bun it was skipped entirely — which is how a Meetily logo
 * and a meetily.zackriya.com link shipped inside the About dialog.
 *
 * The rules live in ./branding-scan.mjs so the Bun and Node gates can never
 * drift apart.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  scanText,
  scanVendorUrls,
  scanBrandAssets,
  scanAboutPanel,
} from './branding-scan.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const fmt = (v) =>
  v.map((x) => `  ${x.file}:${x.line ?? ''} ${x.text ?? x.url ?? x.sha256 ?? x.pattern}`).join('\n')

describe('Recall branding regression gate (node)', () => {
  it('no old-brand text on production surfaces', () => {
    const { filesScanned, violations } = scanText(repoRoot)
    assert.ok(filesScanned > 0, 'expected the scan to reach production files')
    assert.equal(
      violations.length,
      0,
      `old-brand references outside the allowlist:\n${fmt(violations)}`,
    )
  })

  it('product links never point at the old vendor', () => {
    const violations = scanVendorUrls(repoRoot)
    assert.equal(violations.length, 0, `vendor URLs in product source:\n${fmt(violations)}`)
  })

  it('retired Meetily image assets are gone from the brand folders', () => {
    const { assetsScanned, violations } = scanBrandAssets(repoRoot)
    assert.ok(assetsScanned > 0, 'expected brand assets to be scanned')
    assert.equal(
      violations.length,
      0,
      `retired Meetily assets still present:\n${fmt(violations)}`,
    )
  })

  it('About panel carries no marketing calls to action', () => {
    const violations = scanAboutPanel(repoRoot)
    assert.equal(violations.length, 0, `marketing patterns in About:\n${fmt(violations)}`)
  })

  it('core product identity says Recall', async () => {
    const fs = await import('node:fs')
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend/package.json'), 'utf8'))
    assert.equal(pkg.name, 'recall')

    const tauriConf = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'frontend/src-tauri/tauri.conf.json'), 'utf8'),
    )
    assert.equal(tauriConf.productName, 'Recall')
    // bundle.publisher drives the Windows "Publisher" column and the MSI
    // Manufacturer property. Left unset, Tauri derives it from the second
    // element of the identifier (com.meetily.ai -> "meetily"), which is how the
    // old vendor ended up in Windows Apps & Features.
    assert.equal(tauriConf.bundle.publisher, 'Recall')
    // Identifier is deliberately preserved for user-data compatibility.
    assert.equal(tauriConf.identifier, 'com.meetily.ai')
  })
})
