# Tests (Red)

**Status:** Red proven — both suites fail because the implementation seam
`src/services/ytdlp.js` does not exist yet. Run with `npm test` (`vitest run`).

Test stack introduced from scratch (the repo had none): **Vitest 3** (`environment:
node`, `include: src/**/*.test.ts`), wired via `vitest.config.ts` and the
`test` / `test:watch` scripts in `package.json`.

## Seam under test

All Red tests target one new pure-function module the implementer must create,
`src/services/ytdlp.ts` (imported as `./ytdlp.js`). Pure builders/parsers were
chosen deliberately so the Red stage stays blind to the eventual subprocess
wiring while still pinning the injection-safety, language-honoring, contract, and
fallback behavior. Expected exports:

- `buildTranscriptArgs({ videoId, language }): string[]`
- `buildDownloadArgs({ videoId, format, quality }): string[]`
- `isValidVideoId(id): boolean`
- `parseJson3Transcript(rawJson: string): { text: string; offset: number; duration: number }[]`

## Test catalog

### `src/services/ytdlp-command.test.ts`
- **buildTranscriptArgs**
  - returns an argument ARRAY with `videoId` as a discrete element, never
    concatenated into another arg → hazard: *command injection* (use
    execFile/spawn array, never a shell string).
  - honors the requested language via `--sub-lang(s)` → bug (a): *language was
    silently ignored*.
  - requests `--sub-format json3` and `--skip-download` → Decision 2 (structured
    contract from json3).
  - requests BOTH `--write-sub(s)` and `--write-auto-sub(s)` → Decision 6
    (auto-sub fallback).
- **buildDownloadArgs**
  - passes `videoId` as a discrete array element → injection-safe.
  - does NOT extract audio for `mp4` video downloads.
  - opts into `--extract-audio` + `--audio-format` for `mp3`/`wav` → Decision 4
    (media download; ffmpeg-backed audio).
  - rejects format/quality values outside the allowed enums → injection defense
    at the param boundary.
- **isValidVideoId**
  - accepts canonical YouTube IDs (`[A-Za-z0-9_-]{11}`).
  - rejects shell/argument-injection payloads (empty, `; rm -rf /`, `$(...)`,
    backticks, pipes, newlines, path separators, quotes) → hazard: *command
    injection*.

### `src/services/ytdlp-transcript-parse.test.ts`
- **parseJson3Transcript** → Decision 2 + *data-contract* hazard
  - maps `events[].tStartMs → offset`, `dDurationMs → duration`, joined
    `segs[].utf8 → text`.
  - preserves millisecond timing exactly (no rounding to seconds).
  - skips windowing/empty events with no `segs` (no blank lines).
  - returns `[]` for no caption events / empty object.

## Coverage map vs RESEARCH.md

| RESEARCH item | Codified as Red test? |
|---|---|
| Decision 1 — yt-dlp replaces `youtube-transcript` | Indirect: all transcript behavior is asserted against the new `ytdlp.ts` seam; no test imports `youtube-transcript`. Removal of the dependency/import is verified at Green by `npm run build`. |
| Decision 2 — keep `{text, offset, duration}` from json3 | ✅ `parseJson3Transcript` suite |
| Decision 3 — yt-dlp system prereq; ENOENT clear error | ⚠️ Deferred (integration) — see below |
| Decision 4 — media/audio download tools | ✅ `buildDownloadArgs` suite (args shape); temp-dir cleanup deferred |
| Decision 5 — API-key gate unchanged | Not tested (asserts existing behavior; no change) |
| Decision 6 — auto-sub fallback + human/auto flag | ✅ args fallback; ⚠️ response flag deferred (integration) |
| Bug (a) — `language` honored AND truthfully reported | ✅ honored (args); ⚠️ "reported language matches fetched" deferred |
| Bug (b) — graceful "unavailable" vs backend failure | ⚠️ Deferred (integration) |
| Hazard — command injection | ✅ `isValidVideoId` + enum rejection |
| Hazard — stdout discipline (no MCP stdio corruption) | ⚠️ Deferred (integration) |
| Hazard — per-request temp dir + cleanup / concurrency | ⚠️ Deferred (integration) |

## Open questions / deferred to the planner

The following RESEARCH requirements are real but are **integration/subprocess**
behaviors that can't be unit-tested without dictating the service's internal
structure (which spawn wrapper, where temp dirs live, how stderr is captured).
They were intentionally left out of the pure-seam Red tests. The planner should
decide whether to (1) add a thin, mockable subprocess seam so these get
integration tests during the Red-refine/Green loop, or (2) cover them as
implementation requirements with manual verification:

1. **ENOENT / yt-dlp-missing** must produce a clear, actionable error (Decision 3).
2. **Graceful "no captions available"** must be distinguishable from a backend
   failure (Bug b) — and the response must flag **human vs. auto** subs (Decision 6).
3. **Reported `language` must equal the language actually fetched** (Bug a, second
   half) — i.e. derived from the produced subtitle file, not echoed from the request.
4. **stdout discipline** — yt-dlp's own stdout/progress must never reach the
   process stdout (MCP stdio JSON-RPC channel); capture child stdout/stderr.
5. **Per-request temp dir + `finally` cleanup**, unique per invocation so
   concurrent (HTTP stateless) requests don't collide; do NOT reuse the dead
   `download.ts` `cwd()/downloads` no-cleanup pattern.

Recommended seam to make #1–#5 testable without over-specifying: have `ytdlp.ts`
also export a runner that takes an injectable `execFile`-like function, so tests
can stub exit codes / `ENOENT` / stdout and assert error mapping and cleanup.
