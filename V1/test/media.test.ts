import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectKind, generateMedia } from "../src/media/generator.js";

describe("detectKind", () => {
  it("honors an explicit kind", () => {
    expect(detectKind("asset.png", "video")).toBe("video");
  });

  it.each([["clip.mp4", "video"], ["clip.webm", "video"], ["image.png", "image"], ["unknown.bin", "image"]] as const)("detects %s as %s", (path, kind) => {
    expect(detectKind(path)).toBe(kind);
  });
});

describe("generateMedia routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("routes image outputs to the Gemini image endpoint and writes inline data", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const outputDir = await mkdtemp(join(tmpdir(), "sol-media-"));
    const outputPath = join(outputDir, "asset.png");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("image-bytes").toString("base64") } }] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const result = await generateMedia({ prompt: "A sunrise", outputPath });

    expect(result).toMatchObject({ success: true, kind: "image", outputPath, modelUsed: "gemini-3-pro-image", bytes: 11 });
    expect(fetch.mock.calls[0]?.[0]).toContain("gemini-3-pro-image:generateContent");
    expect(await readFile(outputPath, "utf8")).toBe("image-bytes");
    await rm(outputDir, { recursive: true, force: true });
  });

  it("routes video outputs to Veo and handles an immediately-complete operation", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const outputDir = await mkdtemp(join(tmpdir(), "sol-media-"));
    const outputPath = join(outputDir, "asset.mp4");
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("veo-3.1")) {
        return Promise.resolve(new Response(JSON.stringify({
          done: true,
          response: { generateVideoResponse: { generatedVideos: [{ video: { bytesBase64Encoded: Buffer.from("video-bytes").toString("base64") } }] } },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "Omni requires Interactions API" } }), { status: 400 }));
    });
    vi.stubGlobal("fetch", fetch);

    const result = await generateMedia({ prompt: "A sunrise", outputPath });

    expect(result).toMatchObject({ success: true, kind: "video", outputPath, modelUsed: "veo-3.1-generate-preview", bytes: 11 });
    expect(fetch.mock.calls.some((call) => String(call[0]).includes("veo-3.1-generate-preview:predictLongRunning"))).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe("video-bytes");
    await rm(outputDir, { recursive: true, force: true });
  });
});
