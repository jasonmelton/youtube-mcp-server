import { describe, it, expect } from "vitest";

// RED stage — codifies RESEARCH.md Decision 2 ("KEEP structured shape") and the
// "Data-contract / serialization" hazard: yt-dlp json3 subtitles must be parsed
// into the existing `{ text, offset(ms), duration(ms) }` line shape, mapping
// events[].tStartMs -> offset, events[].dDurationMs -> duration, and the joined
// segs[].utf8 -> text, WITHOUT degrading the per-cue timing.
//
// Interface expected of the implementer (see TESTS.md Open Questions): a pure
// parser exported from the yt-dlp integration module.
import { parseJson3Transcript } from "./ytdlp.js";

const json3 = (events: unknown) => JSON.stringify({ events });

describe("parseJson3Transcript", () => {
  it("maps tStartMs->offset, dDurationMs->duration, joined segs[].utf8->text", () => {
    const input = json3([
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "Hello" }, { utf8: " world" }] },
      { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: "Second line" }] },
    ]);

    const lines = parseJson3Transcript(input);

    expect(lines).toEqual([
      { text: "Hello world", offset: 0, duration: 1500 },
      { text: "Second line", offset: 1500, duration: 2000 },
    ]);
  });

  it("preserves millisecond timing exactly (no rounding to seconds)", () => {
    const input = json3([
      { tStartMs: 1234, dDurationMs: 5678, segs: [{ utf8: "precise" }] },
    ]);

    const [line] = parseJson3Transcript(input);

    expect(line.offset).toBe(1234);
    expect(line.duration).toBe(5678);
  });

  it("skips windowing/empty events that carry no segs", () => {
    const input = json3([
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "real cue" }] },
      { tStartMs: 1000, dDurationMs: 500 }, // no segs — must not become a blank line
      { tStartMs: 1500, aAppend: 1 },
    ]);

    const lines = parseJson3Transcript(input);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("real cue");
  });

  it("returns an empty array when there are no caption events", () => {
    expect(parseJson3Transcript(json3([]))).toEqual([]);
    expect(parseJson3Transcript(JSON.stringify({}))).toEqual([]);
  });
});
