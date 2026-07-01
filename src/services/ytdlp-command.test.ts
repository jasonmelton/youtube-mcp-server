import { describe, it, expect } from "vitest";

// RED stage — codifies how yt-dlp is invoked. These pure builders/validators are
// the injection-safe seam: arguments are assembled as an ARRAY (for
// execFile/spawn, never a shell string), the requested language is actually
// passed through, auto-subs are requested as a fallback, and audio downloads opt
// into ffmpeg extraction. Interfaces expected of the implementer (see TESTS.md
// Open Questions): `buildTranscriptArgs`, `buildDownloadArgs`, `isValidVideoId`.
import {
  buildTranscriptArgs,
  buildDownloadArgs,
  isValidVideoId,
} from "./ytdlp.js";

const VALID_ID = "dQw4w9WgXcQ";

// Find the value following a flag that matches `flag` (yt-dlp uses
// "--flag value" space-separated arguments).
function valueAfter(args: string[], flag: RegExp): string | undefined {
  const idx = args.findIndex((a) => flag.test(a));
  return idx >= 0 ? args[idx + 1] : undefined;
}

describe("buildTranscriptArgs", () => {
  it("returns an argument ARRAY (no shell string) with videoId as a discrete element", () => {
    const args = buildTranscriptArgs({ videoId: VALID_ID, language: "en" });
    expect(Array.isArray(args)).toBe(true);
    // videoId must be its own element, never concatenated into another argument.
    expect(args).toContain(VALID_ID);
    expect(args.some((a) => a !== VALID_ID && a.includes(VALID_ID))).toBe(false);
  });

  it("honors the requested language via a --sub-lang(s) flag (bug: language was ignored)", () => {
    const args = buildTranscriptArgs({ videoId: VALID_ID, language: "es" });
    const langValue = valueAfter(args, /^--sub-langs?$/);
    expect(langValue).toBeDefined();
    expect(langValue).toContain("es");
  });

  it("requests json3 subtitle format and skips the media download", () => {
    const args = buildTranscriptArgs({ videoId: VALID_ID, language: "en" });
    expect(valueAfter(args, /^--sub-format$/)).toContain("json3");
    expect(args).toContain("--skip-download");
  });

  it("requests BOTH human subs and auto-generated subs as a fallback (Decision 6)", () => {
    const args = buildTranscriptArgs({ videoId: VALID_ID, language: "en" });
    expect(args.some((a) => /^--write-subs?$/.test(a))).toBe(true);
    expect(args.some((a) => /^--write-auto-subs?$/.test(a))).toBe(true);
  });
});

describe("buildDownloadArgs", () => {
  it("passes videoId as a discrete array element (injection-safe)", () => {
    const args = buildDownloadArgs({ videoId: VALID_ID, format: "mp4", quality: "highest" });
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain(VALID_ID);
    expect(args.some((a) => a !== VALID_ID && a.includes(VALID_ID))).toBe(false);
  });

  it("does NOT extract audio for a video (mp4) download", () => {
    const args = buildDownloadArgs({ videoId: VALID_ID, format: "mp4", quality: "highest" });
    expect(args.some((a) => /^(--extract-audio|-x)$/.test(a))).toBe(false);
  });

  it("opts into ffmpeg audio extraction for mp3 / wav downloads", () => {
    for (const format of ["mp3", "wav"] as const) {
      const args = buildDownloadArgs({ videoId: VALID_ID, format, quality: "highest" });
      expect(args.some((a) => /^(--extract-audio|-x)$/.test(a))).toBe(true);
      expect(valueAfter(args, /^--audio-format$/)).toBe(format);
    }
  });

  it("rejects formats and qualities outside the allowed enums", () => {
    expect(() =>
      // @ts-expect-error invalid format must be rejected, not shelled out
      buildDownloadArgs({ videoId: VALID_ID, format: "exe; rm -rf /", quality: "highest" }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error invalid quality must be rejected
      buildDownloadArgs({ videoId: VALID_ID, format: "mp4", quality: "$(whoami)" }),
    ).toThrow();
  });
});

describe("isValidVideoId", () => {
  it("accepts canonical YouTube video IDs", () => {
    expect(isValidVideoId(VALID_ID)).toBe(true);
    expect(isValidVideoId("abcDEF123_z")).toBe(true);
  });

  it("rejects shell-injection / argument-injection payloads", () => {
    const malicious = [
      "",
      "; rm -rf /",
      "a b",
      "$(whoami)",
      "`id`",
      "a|b",
      "a&b",
      "a;b",
      "../etc/passwd",
      "a/b",
      "a\\b",
      "id\nrm -rf /",
      '"quoted"',
    ];
    for (const id of malicious) {
      expect(isValidVideoId(id), `expected ${JSON.stringify(id)} to be rejected`).toBe(false);
    }
  });
});
