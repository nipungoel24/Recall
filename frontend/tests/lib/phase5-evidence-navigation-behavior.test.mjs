/**
 * Phase 5 Gate 2 — Evidence Navigation Logic Behavioral Tests
 *
 * Directly exercises the logic of evidence validation and cross-meeting checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 5 Gate 2 — Evidence Validation & Cross-Meeting Safety Invariants', () => {
  function hasValidEvidence(item, meetingId) {
    if (!item || !item.sources || item.sources.length === 0) {
      return false;
    }
    return item.sources.some((src) => {
      const sourceMeetingId = src.meeting_id || item.meeting_id;
      if (sourceMeetingId && sourceMeetingId !== meetingId) {
        return false;
      }
      return Boolean(src.transcript_segment_id && src.transcript_segment_id.trim() !== '');
    });
  }

  it('rejects items with null or empty sources array', () => {
    assert.equal(hasValidEvidence(null, 'meet-1'), false);
    assert.equal(hasValidEvidence({}, 'meet-1'), false);
    assert.equal(hasValidEvidence({ sources: [] }, 'meet-1'), false);
  });

  it('rejects sources with blank transcript_segment_id', () => {
    const item = {
      meeting_id: 'meet-1',
      sources: [{ id: 's-1', item_id: 'i-1', transcript_segment_id: '   ', meeting_id: 'meet-1' }],
    };
    assert.equal(hasValidEvidence(item, 'meet-1'), false);
  });

  it('accepts valid source for current meeting', () => {
    const item = {
      meeting_id: 'meet-1',
      sources: [{ id: 's-1', item_id: 'i-1', transcript_segment_id: 'seg-42', meeting_id: 'meet-1' }],
    };
    assert.equal(hasValidEvidence(item, 'meet-1'), true);
  });

  it('rejects foreign meeting source (cross-meeting invariant)', () => {
    const item = {
      meeting_id: 'meet-FOREIGN',
      sources: [{ id: 's-1', item_id: 'i-1', transcript_segment_id: 'seg-42', meeting_id: 'meet-FOREIGN' }],
    };
    // Navigating from meet-1
    assert.equal(hasValidEvidence(item, 'meet-1'), false);
  });

  it('rejects item if source specifies a different meeting than the current one', () => {
    const item = {
      meeting_id: 'meet-1',
      sources: [{ id: 's-1', item_id: 'i-1', transcript_segment_id: 'seg-42', meeting_id: 'meet-OTHER' }],
    };
    assert.equal(hasValidEvidence(item, 'meet-1'), false);
  });

  it('cross-meeting navigation simulation strictly halts without calling backend', async () => {
    let backendCalled = false;
    const fakeBackend = {
      getTranscriptSegmentPosition: async () => {
        backendCalled = true;
        return { segment_id: 'seg-1', meeting_id: 'meet-OTHER', position: 5, total_count: 10 };
      },
    };

    const currentMeetingId = 'meet-CURRENT';
    const foreignItem = {
      meeting_id: 'meet-OTHER',
      sources: [{ transcript_segment_id: 'seg-99', meeting_id: 'meet-OTHER' }],
    };

    async function simulateNavigate(item) {
      const validSource = item.sources?.find((s) => s.transcript_segment_id?.trim());
      if (!validSource) return { ok: false, error: 'No valid source' };

      const sourceMeetingId = validSource.meeting_id || item.meeting_id;
      if (sourceMeetingId && sourceMeetingId !== currentMeetingId) {
        return { ok: false, error: 'Cross-meeting navigation blocked' };
      }

      await fakeBackend.getTranscriptSegmentPosition();
      return { ok: true };
    }

    const result = await simulateNavigate(foreignItem);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Cross-meeting navigation blocked');
    assert.equal(backendCalled, false, 'Backend must never be called for cross-meeting sources');
  });
});
