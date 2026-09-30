export type MediaKind = "image" | "video";

export interface MediaOptions {
  prompt: string;
  outputPath: string;
  kind?: MediaKind;
  aspectRatio?: string;
  durationSeconds?: number;
  model?: string;
}

export interface MediaResult {
  success: boolean;
  outputPath: string;
  kind: MediaKind;
  modelUsed: string;
  bytes: number;
  durationMs: number;
  error?: string;
}
