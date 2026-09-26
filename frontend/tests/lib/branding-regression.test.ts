import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import {
  scanText,
  scanVendorUrls,
  scanBrandAssets,
  scanAboutPanel,
} from './branding-scan.mjs';

/**
 * Recall branding regression gate — Bun runner.
 *
 * The rules live in ./branding-scan.mjs and are shared with
 * branding-regression.test.mjs (the Node runner). Both gates must stay in sync;
 * the Node one exists because this file historically could not execute on hosts
 * without Bun, which is how Meetily branding reached the shipped About dialog.
 *
 * Tolerated references are classified in the scanner: MIGRATION_COMPAT (legacy
 * data paths, env fallbacks, the preserved app-data identifier), LEGAL_ATTRIBUTION
 * (the MIT notice), and UPSTREAM_HISTORY (applied migrations).
 */

const repoRoot = path.resolve(import.meta.dir, '..', '..', '..');

describe('Recall branding regression gate (bun)', () => {
  test(
    'no accidental old-brand text on production surfaces',
    () => {
      const { filesScanned, violations } = scanText(repoRoot);
      expect(filesScanned).toBeGreaterThan(0);
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

  test('product links never point at the old vendor', () => {
    expect(scanVendorUrls(repoRoot)).toEqual([]);
  });

  test('retired old-brand image assets are gone from the brand folders', () => {
    const { assetsScanned, violations } = scanBrandAssets(repoRoot);
    expect(assetsScanned).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  test('About panel carries no marketing calls to action', () => {
    expect(scanAboutPanel(repoRoot)).toEqual([]);
  });
});
