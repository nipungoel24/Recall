/**
 * Meeting Intelligence Service
 *
 * Typed wrappers for the Meeting Intelligence Tauri commands.
 * Pure 1-to-1 wrappers - thin service layer matching existing service patterns.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  MeetingIntelligence,
  MeetingIntelligenceItem,
  MeetingIntelligenceItemSource,
  MeetingIntelligenceResponse,
  IntelligenceItemResponse,
  IntelligenceSourceResponse,
  TranscriptSegmentPosition,
  GenerateIntelligenceRequest,
  IntelligenceItemRequest,
  IntelligenceItemSourceRequest,
} from '@/types';

export class MeetingIntelligenceService {
  /**
   * Get the intelligence record for a meeting
   * @param meetingId - Meeting ID
   * @returns Promise with intelligence record or null if not found
   */
  async getMeetingIntelligence(meetingId: string): Promise<MeetingIntelligence | null> {
    if (!meetingId.trim()) {
      throw new Error('meetingId cannot be empty');
    }

    const result = await invoke<MeetingIntelligenceResponse | null>('api_get_meeting_intelligence', {
      meetingId,
    });

    if (!result) return null;

    return {
      meeting_id: result.meeting_id,
      abstract_text: result.abstract_text ?? null,
      schema_version: result.schema_version,
      generated_at: result.generated_at ?? null,
      provider: result.provider ?? null,
      model: result.model ?? null,
    };
  }

  /**
   * Get all intelligence items for a meeting with their sources
   * @param meetingId - Meeting ID
   * @returns Promise with array of intelligence items with their sources
   */
  async getMeetingIntelligenceItems(meetingId: string): Promise<MeetingIntelligenceItem[]> {
    if (!meetingId.trim()) {
      throw new Error('meetingId cannot be empty');
    }

    const items = await invoke<IntelligenceItemResponse[]>('api_get_meeting_intelligence_items', {
      meetingId,
    });

    return items.map(item => ({
      id: item.id,
      meeting_id: item.meeting_id,
      kind: item.kind,
      text: item.text,
      ordering: item.ordering,
      confidence: item.confidence ?? null,
      owner: item.owner ?? null,
      due_date: item.due_date ?? null,
      status: item.status ?? null,
      sources: item.sources.map(src => ({
        id: src.id,
        item_id: src.item_id,
        transcript_segment_id: src.transcript_segment_id,
        meeting_id: src.meeting_id,
        created_at: undefined,
      })),
      created_at: undefined,
      updated_at: undefined,
    }));
  }

  /**
   * Generate structured intelligence for a meeting (AI-powered)
   * @param meetingId - Meeting ID
   * @param customPrompt - Optional custom prompt to guide generation
   * @param templateId - Optional template ID (defaults to 'standard_meeting')
   * @returns Generated intelligence with abstract and items
   */
  async generateMeetingIntelligence(
    meetingId: string,
    customPrompt?: string,
    templateId?: string,
  ): Promise<{
    meeting_id: string;
    abstract_text: string;
    topics: MeetingIntelligenceItem[];
    decisions: MeetingIntelligenceItem[];
    actions: MeetingIntelligenceItem[];
    questions: MeetingIntelligenceItem[];
    facts: MeetingIntelligenceItem[];
    follow_ups: MeetingIntelligenceItem[];
  }> {
    if (!meetingId.trim()) {
      throw new Error('meetingId cannot be empty');
    }

    const result = await invoke<{
      meeting_id: string;
      abstract_text: string;
      topics: IntelligenceItemResponse[];
      decisions: IntelligenceItemResponse[];
      actions: IntelligenceItemResponse[];
      questions: IntelligenceItemResponse[];
      facts: IntelligenceItemResponse[];
      follow_ups: IntelligenceItemResponse[];
    }>('api_generate_meeting_intelligence', {
      // The Rust command takes a single `request: GenerateIntelligenceRequest`
      // parameter, not flat arguments. Sending them flat makes Tauri reject the
      // call with a missing-argument error, so the payload has to be nested.
      request: {
        meetingId,
        customPrompt,
        templateId: templateId ?? 'standard_meeting',
      },
    });

    return {
      meeting_id: result.meeting_id,
      abstract_text: result.abstract_text,
      topics: result.topics.map(this.mapIntelligenceItem),
      decisions: result.decisions.map(this.mapIntelligenceItem),
      actions: result.actions.map(this.mapIntelligenceItem),
      questions: result.questions.map(this.mapIntelligenceItem),
      facts: result.facts.map(this.mapIntelligenceItem),
      follow_ups: result.follow_ups.map(this.mapIntelligenceItem),
    };
  }

  /**
   * Get transcript segment by ID (for evidence navigation)
   * @param segmentId - Transcript segment ID
   * @returns Promise with transcript segment or null if not found
   */
  async getTranscriptSegment(segmentId: string): Promise<{
    id: string;
    meeting_id: string;
    text: string;
    timestamp: string;
    sequence_id?: number;
    chunk_start_time?: number;
    is_partial?: boolean;
    confidence?: number;
    audio_start_time?: number;
    audio_end_time?: number;
    duration?: number;
  } | null> {
    if (!segmentId.trim()) {
      throw new Error('segmentId cannot be empty');
    }

    const segment = await invoke<{
      id: string;
      meeting_id: string;
      transcript: string;
      timestamp: string;
      summary?: string;
      action_items?: string;
      key_points?: string;
      audio_start_time?: number;
      audio_end_time?: number;
      duration?: number;
    } | null>('api_get_transcript_segment', { segmentId });

    if (!segment) return null;

    return {
      id: segment.id,
      meeting_id: segment.meeting_id,
      text: segment.transcript,
      timestamp: segment.timestamp,
      audio_start_time: segment.audio_start_time,
      audio_end_time: segment.audio_end_time,
      duration: segment.duration,
    };
  }

  /**
   * Get transcript segment position/index within a meeting (for evidence navigation)
   * @param meetingId - Meeting ID
   * @param segmentId - Transcript segment ID
   * @returns Promise with segment position and total count, or null if not found
   */
  async getTranscriptSegmentPosition(
    meetingId: string,
    segmentId: string,
  ): Promise<TranscriptSegmentPosition | null> {
    if (!meetingId.trim()) {
      throw new Error('meetingId cannot be empty');
    }
    if (!segmentId.trim()) {
      throw new Error('segmentId cannot be empty');
    }

    const result = await invoke<{
      segment_id: string;
      meeting_id: string;
      position: number;
      total_count: number;
    } | null>('api_get_transcript_segment_position', { meetingId, segmentId });

    if (!result) return null;

    return {
      segment_id: result.segment_id,
      meeting_id: result.meeting_id,
      position: result.position,
      total_count: result.total_count,
    };
  }

  /**
   * Map backend intelligence item response to frontend type
   */
  private mapIntelligenceItem(item: {
    id: string;
    meeting_id: string;
    kind: string;
    text: string;
    ordering: number;
    confidence: number | null;
    owner: string | null;
    due_date: string | null;
    status: string | null;
    sources: { id: string; item_id: string; transcript_segment_id: string; meeting_id: string }[];
  }): MeetingIntelligenceItem {
    return {
      id: item.id,
      meeting_id: item.meeting_id,
      kind: item.kind as 'topic' | 'decision' | 'action' | 'question' | 'fact' | 'follow_up',
      text: item.text,
      ordering: item.ordering,
      confidence: item.confidence ?? null,
      owner: item.owner ?? null,
      due_date: item.due_date ?? null,
      status: item.status ?? null,
      sources: item.sources.map(src => ({
        id: src.id,
        item_id: src.item_id,
        transcript_segment_id: src.transcript_segment_id,
        meeting_id: src.meeting_id,
        created_at: '', // Not returned by backend
      })),
      created_at: '', // Not returned by backend
      updated_at: '', // Not returned by backend
    };
  }
}

export const meetingIntelligenceService = new MeetingIntelligenceService();