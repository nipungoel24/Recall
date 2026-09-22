export interface Message {
  id: string;
  content: string;
  timestamp: string;
}

export interface Transcript {
  id: string;
  text: string;
  timestamp: string; // Wall-clock time (e.g., "14:30:05")
  sequence_id?: number;
  chunk_start_time?: number; // Legacy field
  is_partial?: boolean;
  confidence?: number;
  // NEW: Recording-relative timestamps for playback sync
  audio_start_time?: number; // Seconds from recording start (e.g., 125.3)
  audio_end_time?: number;   // Seconds from recording start (e.g., 128.6)
  duration?: number;          // Segment duration in seconds (e.g., 3.3)
  speaker?: string | null;
}

export interface TranscriptUpdate {
  text: string;
  timestamp: string; // Wall-clock time for reference
  source: string;
  sequence_id: number;
  chunk_start_time: number; // Legacy field
  is_partial: boolean;
  confidence: number;
  // NEW: Recording-relative timestamps for playback sync
  audio_start_time: number; // Seconds from recording start
  audio_end_time: number;   // Seconds from recording start
  duration: number;          // Segment duration in seconds
}

export interface Block {
  id: string;
  type: string;
  content: string;
  color: string;
}

export interface Section {
  title: string;
  blocks: Block[];
}

export interface Summary {
  [key: string]: Section;
}

export interface ApiResponse {
  message: string;
  num_chunks: number;
  data: any[];
}

export interface SummaryResponse {
  status: string;
  summary: Summary;
  raw_summary?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// BlockNote-specific types
export type SummaryFormat = 'legacy' | 'markdown' | 'blocknote';

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

export interface SummaryDataResponse {
  markdown?: string;
  summary_json?: BlockNoteBlock[];
  // Legacy format fields
  MeetingName?: string;
  _section_order?: string[];
  [key: string]: any; // For legacy section data
}

// Pagination types for optimized transcript loading
export interface MeetingMetadata {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder_path?: string;
  // Present on calendar/list responses; meeting duration derived from transcript timing
  duration_seconds?: number;
}

export interface PaginatedTranscriptsResponse {
  transcripts: Transcript[];
  total_count: number;
  has_more: boolean;
}

// Transcript segment data for virtualized display
export interface TranscriptSegmentData {
  id: string;
  timestamp: number; // audio_start_time in seconds
  endTime?: number; // audio_end_time in seconds
  text: string;
  confidence?: number;
  speaker?: string | null;
}

// Meeting Intelligence types (Phase 5)
export type IntelligenceKind = 'topic' | 'decision' | 'action' | 'question' | 'fact' | 'follow_up';

export interface MeetingIntelligence {
  meeting_id: string;
  abstract_text: string | null;
  schema_version: number;
  generated_at: string | null;
  provider: string | null;
  model: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MeetingIntelligenceItem {
  id: string;
  meeting_id: string;
  kind: IntelligenceKind;
  text: string;
  ordering: number;
  confidence: number | null;
  owner: string | null;
  due_date: string | null;
  status: string | null;
  sources: MeetingIntelligenceItemSource[];
  created_at?: string;
  updated_at?: string;
}

export interface MeetingIntelligenceItemSource {
  id: string;
  item_id: string;
  transcript_segment_id: string;
  meeting_id: string;
  created_at?: string;
}

export interface MeetingIntelligenceResponse {
  meeting_id: string;
  abstract_text: string | null;
  schema_version: number;
  generated_at: string | null;
  provider: string | null;
  model: string | null;
}

export interface IntelligenceItemResponse {
  id: string;
  meeting_id: string;
  kind: IntelligenceKind;
  text: string;
  ordering: number;
  confidence: number | null;
  owner: string | null;
  due_date: string | null;
  status: string | null;
  sources: IntelligenceSourceResponse[];
}

export interface IntelligenceSourceResponse {
  id: string;
  item_id: string;
  transcript_segment_id: string;
  meeting_id: string;
}

export interface TranscriptSegmentPosition {
  segment_id: string;
  meeting_id: string;
  position: number;      // 0-based index
  total_count: number;   // total segments in meeting
}

export interface GenerateIntelligenceRequest {
  meeting_id: string;
  custom_prompt?: string;
  template_id?: string;
}

export interface IntelligenceItemRequest {
  kind: IntelligenceKind;
  text: string;
  confidence?: number | null;
  owner?: string | null;
  due_date?: string | null;
  status?: string | null;
  sources: string[];
}

export interface IntelligenceItemSourceRequest {
  item_id: string;
  transcript_segment_id: string;
}
