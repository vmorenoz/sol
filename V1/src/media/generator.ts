import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import type { MediaKind, MediaOptions, MediaResult } from "./types.js";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const IMAGE_MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
const VEO_MODELS = ["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview"];
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const VIDEO_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 4_000;

interface ApiError { error?: { message?: string } }
interface Operation { name?: string; done?: boolean; response?: unknown; error?: { message?: string } }

export function detectKind(outputPath: string, explicitKind?: MediaKind): MediaKind {
  if (explicitKind) return explicitKind;
  const extension = extname(outputPath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return "image";
}

export function resolveApiKey(): string {
  const environmentKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (environmentKey?.trim()) return environmentKey.trim();

  try {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
    const google = (auth.google ?? (auth.auth as Record<string, unknown> | undefined)?.google) as { key?: unknown } | undefined;
    const key = google?.key;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // The optional OpenCode auth file is not required when an environment key is present.
  }

  throw new Error("No Gemini API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY, or sign in to OpenCode with Google.");
}

async function apiJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiError;
    throw new Error(body.error?.message ?? `Gemini API request failed (${response.status})`);
  }
  return response.json();
}

function inlineData(response: unknown): string | undefined {
  const record = response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }> };
  const parts = record.candidates?.[0]?.content?.parts ?? [];
  return parts.find((part) => typeof part.inlineData?.data === "string")?.inlineData?.data as string | undefined;
}

async function writeAsset(outputPath: string, data: Buffer): Promise<number> {
  if (!data.length) throw new Error("Media API returned an empty asset");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, data);
  return data.length;
}

async function generateImage(options: MediaOptions, apiKey: string): Promise<{ bytes: number; model: string }> {
  const models = options.model ? [options.model, ...IMAGE_MODELS.filter((model) => model !== options.model)] : IMAGE_MODELS;
  const errors: string[] = [];

  for (const model of models) {
    try {
      const response = await apiJson(`${API_ROOT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: options.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });
      const data = inlineData(response);
      if (!data) throw new Error("Gemini image response did not include inline image data");
      return { bytes: await writeAsset(options.outputPath, Buffer.from(data, "base64")), model };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Image generation failed. ${errors.join("; ")}`);
}

function videoPayload(response: unknown): { base64?: string; uri?: string } {
  const record = response as { generateVideoResponse?: { generatedVideos?: Array<{ video?: { bytesBase64Encoded?: unknown; uri?: unknown } }> } };
  const video = record.generateVideoResponse?.generatedVideos?.[0]?.video;
  return {
    ...(typeof video?.bytesBase64Encoded === "string" ? { base64: video.bytesBase64Encoded } : {}),
    ...(typeof video?.uri === "string" ? { uri: video.uri } : {}),
  };
}

async function pollOperation(operation: Operation, apiKey: string): Promise<unknown> {
  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  let current = operation;
  while (!current.done) {
    if (!current.name) throw new Error("Veo did not return an operation name");
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Veo video generation after 120 seconds");
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await apiJson(`${API_ROOT}/${current.name}?key=${encodeURIComponent(apiKey)}`) as Operation;
  }
  if (current.error?.message) throw new Error(current.error.message);
  if (!current.response) throw new Error("Veo operation completed without a video response");
  return current.response;
}

async function generateVeoVideo(options: MediaOptions, apiKey: string, model: string): Promise<{ bytes: number; model: string }> {
  const operation = await apiJson(`${API_ROOT}/models/${model}:predictLongRunning?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: options.prompt }],
      parameters: { sampleCount: 1 },
    }),
  }) as Operation;
  const video = videoPayload(await pollOperation(operation, apiKey));
  if (video.base64) return { bytes: await writeAsset(options.outputPath, Buffer.from(video.base64, "base64")), model };
  if (video.uri) {
    const response = await fetch(video.uri);
    if (!response.ok) throw new Error(`Could not download generated video (${response.status})`);
    return { bytes: await writeAsset(options.outputPath, Buffer.from(await response.arrayBuffer())), model };
  }
  throw new Error("Veo response did not include video bytes or a video URI");
}

async function tryOmniVideo(options: MediaOptions, apiKey: string): Promise<{ bytes: number; model: string }> {
  const model = "gemini-omni-flash-preview";
  const response = await apiJson(`${API_ROOT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: options.prompt }] }], generationConfig: { responseModalities: ["VIDEO"] } }),
  });
  const data = inlineData(response);
  if (!data) throw new Error("Gemini Omni response did not include inline video data");
  return { bytes: await writeAsset(options.outputPath, Buffer.from(data, "base64")), model };
}

async function generateVideo(options: MediaOptions, apiKey: string): Promise<{ bytes: number; model: string }> {
  const errors: string[] = [];
  const shouldTryOmni = !options.model || options.model === "gemini-omni-flash-preview";
  if (shouldTryOmni) {
    try {
      return await tryOmniVideo(options, apiKey);
    } catch (error) {
      errors.push(`gemini-omni-flash-preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const models = options.model && options.model !== "gemini-omni-flash-preview"
    ? [options.model, ...VEO_MODELS.filter((model) => model !== options.model)]
    : VEO_MODELS;
  for (const model of models) {
    try {
      return await generateVeoVideo(options, apiKey, model);
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Video generation failed. ${errors.join("; ")}`);
}

export async function generateMedia(options: MediaOptions): Promise<MediaResult> {
  const startedAt = Date.now();
  const kind = detectKind(options.outputPath, options.kind);
  const fallbackModel = kind === "image" ? (options.model ?? IMAGE_MODELS[0]!) : (options.model ?? VEO_MODELS[0]!);
  try {
    const apiKey = resolveApiKey();
    const generated = kind === "image"
      ? await generateImage(options, apiKey)
      : await generateVideo(options, apiKey);
    return { success: true, outputPath: options.outputPath, kind, modelUsed: generated.model, bytes: generated.bytes, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      success: false, outputPath: options.outputPath, kind, modelUsed: fallbackModel, bytes: 0,
      durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error),
    };
  }
}
