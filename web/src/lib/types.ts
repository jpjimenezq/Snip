// Tipos que reflejan supabase/migrations/0001_init.sql y los contratos de docs/ARCHITECTURE.md

export type Platform = "youtube" | "kick" | "twitch" | "other";
export type SourceStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";
export type ClipStatus =
  | "suggested"
  | "queued_render"
  | "rendering"
  | "rendered"
  | "error";
export type ClipOrigin = "ai" | "manual" | "hotkey";
export type SubtitleStyle = "karaoke" | "simple" | "none";
export type JobType =
  | "process_source"
  | "render_clip"
  | "generate_copy"
  | "manual_clip";

export interface Source {
  id: string;
  user_id: string;
  url: string;
  platform: Platform;
  title: string | null;
  channel: string | null;
  duration_s: number | null;
  status: SourceStatus;
  progress: number;
  error: string | null;
  local_path: string | null;
  thumb_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutPreset = "fill" | "fit_blur" | "split";

export interface Layout {
  preset: LayoutPreset;
  regions: Region[];
  split_ratio?: number;
}

export interface YouTubeCopy {
  title?: string;
  description?: string;
  tags?: string[];
}
export interface HashtagCopy {
  caption?: string;
  hashtags?: string[];
}
export interface FacebookCopy {
  caption?: string;
}
export interface Copies {
  youtube?: YouTubeCopy;
  tiktok?: HashtagCopy;
  instagram?: HashtagCopy;
  facebook?: FacebookCopy;
}

export interface Clip {
  id: string;
  source_id: string;
  user_id: string;
  origin: ClipOrigin;
  start_s: number;
  end_s: number;
  title: string | null;
  hook: string | null;
  reason: string | null;
  score: number | null;
  layout: Layout | null;
  subtitle_style: SubtitleStyle;
  status: ClipStatus;
  progress: number;
  error: string | null;
  frame_path: string | null;
  preview_path: string | null;
  output_path: string | null;
  copies: Copies | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}
export interface Transcript {
  source_id: string;
  language: string | null;
  text: string;
  segments: TranscriptSegment[];
  created_at: string;
}

export type SourceWithCount = Source & { clips: { count: number }[] };

export const DEFAULT_LAYOUT: Layout = {
  preset: "fill",
  regions: [{ x: 0.342, y: 0, w: 0.316, h: 1 }],
};
