# Research: Incorporate yt-dlp support

**Issue:** #1  **Branch:** 1-incorporate-yt-dlp-support  **Date:** 2026-06-29
**Status:** COMPLETED — ready for Red (tests)

## Main Purpose
Adopt `yt-dlp` (an actively maintained, frequently-updated downloader) as the
backend for two capabilities:
1. **Transcripts** — REPLACE the brittle `youtube-transcript` scraping library
   outright; yt-dlp becomes the *sole* transcript backend (modeled on how
   [`mcp-youtube`](https://github.com/anaisbetts/mcp-youtube) shells out to
   yt-dlp), while preserving the existing structured return contract.
2. **Media/audio download** — revive the currently-dead download capability
   (`src/functions/content/download.ts`) by re-implementing it on yt-dlp and
   exposing it as new MCP tool(s).

## Issue Summary
Issue #1 body (verbatim intent): "Add yt-dlp support. Consider how mcp-youtube
handles it." The referenced `mcp-youtube` server has essentially one tool:
`download_youtube_url`, which spawns `yt-dlp` to download a video's subtitles
(`--write-sub --write-auto-sub --sub-lang en --skip-download --sub-format vtt`
into a temp dir), strips the VTT timing/markup, and returns the plain transcript
text. The issue was intentionally terse; scope has since been settled with the
owner — see **Decisions** below. No comments on the issue.

## Decisions (settled)
1. **Transcript scope: REPLACE outright.** yt-dlp is the sole transcript backend;
   the `youtube-transcript` dependency is dropped entirely (no library fallback,
   no separate tool — `transcripts_getTranscript` is rewired onto yt-dlp).
2. **Return contract: KEEP structured shape.** Preserve
   `{ videoId, language, transcript: [{text, offset, duration}] }`, sourced from
   yt-dlp `json3` subtitles (machine-parseable, carries per-cue timing). No
   breaking change to clients; the `getTimestampedTranscript` / `searchTranscript`
   helpers keep operating on the same `{text, offset(ms), duration(ms)}` line shape.
3. **yt-dlp delivery: SYSTEM PREREQUISITE.** Require a host-installed `yt-dlp`
   binary; document it as a prerequisite (README + CLAUDE.md). No npm wrapper /
   bundled binary. The "binary missing" (`ENOENT`) path must surface a clear,
   actionable error.
4. **Feature scope: ALSO MEDIA DOWNLOAD.** In addition to transcripts, migrate the
   media/audio download capability onto yt-dlp and expose new MCP tool(s). The dead
   `ytdl-core` + `fluent-ffmpeg` sketch in `download.ts` is replaced; its
   no-cleanup `process.cwd()/downloads` pattern is explicitly NOT reused (use a
   per-request temp dir + `finally` cleanup).
5. **API key: KEEP REQUIRING.** Leave the startup gate (`index.ts:6-10` /
   `cli.ts:8-12`) as-is. The API-backed tools need a key anyway; no keyless mode.
6. **Auto-subs: YES, WITH FLAG.** Request auto-generated subtitles as a fallback
   when no human captions exist, and indicate in the response which kind was
   returned (human vs. auto).

## Relevant Files and Code Paths
- `src/services/transcript.ts:24-42` — `TranscriptService.getTranscript`, the
  ONLY transcript path reachable via MCP today. Calls
  `YoutubeTranscript.fetchTranscript(videoId)`. **Primary rewrite target**: swap
  the library call for a yt-dlp `json3` fetch+parse that honors `language` and
  reports human-vs-auto. The `youtube-transcript` import (`:1`) goes away.
- `src/services/transcript.ts:47-71` / `:76-108` — `searchTranscript` and
  `getTimestampedTranscript`. Not wired into `server.ts` (unreachable as tools),
  but they also call `YoutubeTranscript.fetchTranscript` (`:55`, `:83`). They must
  be repointed at the same yt-dlp source to keep compiling once the library is
  removed (decision 1 + 2), even though they remain unexposed.
- `src/server.ts:171-187` — `transcripts_getTranscript` tool definition (input
  schema: `videoId` required, `language` optional). New download tool(s) will be
  registered alongside in this `ListToolsRequestSchema` block.
- `src/server.ts:408-409` — routing of `transcripts_getTranscript` to
  `transcriptService.getTranscript`. New download tool(s) route in the same
  `CallToolRequestSchema` switch.
- `src/server.ts:65-81` — `createMcpServer`; services constructed per server
  instance. HTTP stateless mode builds a fresh server (and services) per request
  (`src/server.ts:553`), so any yt-dlp service must be cheap and stateless to
  construct.
- `src/functions/content/download.ts:32-218` — **dead code** (`src/functions/**`
  is excluded from compilation, `tsconfig.json:29-32`, and unimported). Defines
  `VideoDownloader` with `downloadVideo` (`:45-74`), `extractThumbnail`
  (`:87-108`), `getDownloadOptions` (`:120-156`) on `ytdl-core` + `fluent-ffmpeg`.
  **Now in scope** as the conceptual model for the new yt-dlp download tool(s).
  Note the anti-patterns to drop: writes to `process.cwd()/downloads`
  (`:56`) and `process.cwd()/thumbnails` (`:95`) with NO cleanup; depends on
  `fluent-ffmpeg` which is not even a declared dependency.
- `src/index.ts:6-10` / `src/cli.ts:8-12` — startup hard-requires a YouTube API
  key. Per decision 5 this gate stays unchanged.
- `src/types.ts:48-60` — `TranscriptParams` / `SearchTranscriptParams`. New
  download param types will be added here.
- `src/types/youtube-transcript.d.ts` and the duplicate block in
  `src/types/global-types.d.ts:48-61` — ambient module decls for
  `youtube-transcript`; `ytdl-core` is similarly declared (`global-types.d.ts`,
  `~:62-91`). Both packages are being removed (decisions 1 + 4), so these ambient
  decls (and the deps in `package.json`) should be cleaned up rather than extended.
- `src/services/youtube-client.ts:108-118` — API-key pool; unrelated to yt-dlp but
  shows the existing service pattern (lazy init, `withYouTubeClient`).

## Existing Tests
- **None.** No `*.test.ts` / `*.spec.ts` anywhere, no `test` script in
  `package.json:15-20`, and no test runner (jest/vitest/mocha) in devDependencies.
  The Red stage must introduce a test runner from scratch. This vacuum is exactly
  why the brittle transcript path slipped through unnoticed.

## Detailed Analysis
**Transcripts today:** MCP client calls `transcripts_getTranscript`
→ `server.ts:408` → `TranscriptService.getTranscript` (`transcript.ts:24`)
→ `YoutubeTranscript.fetchTranscript(videoId)` (`transcript.ts:32`) → returns
`{ videoId, language, transcript: TranscriptLine[] }` where each line is
`{ text, offset(ms), duration(ms) }`. `getTimestampedTranscript`
(`transcript.ts:86-98`) reformats those lines into `mm:ss` timestamps;
`searchTranscript` (`:58-60`) filters by substring. All three share the
`{text, offset, duration}` line shape — which decision 2 preserves.

**Transcript target (yt-dlp, json3):** spawn `yt-dlp` with `--skip-download`,
subtitle flags requesting human subs and (fallback) auto-subs, `--sub-format json3`,
`--sub-lang <language>`, and an `--output` template pointing at a per-request temp
dir. Locate the produced `*.json3` file, parse its `events[]` (each event carries
`tStartMs`, `dDurationMs`, and `segs[].utf8`) into `{ text, offset, duration }`,
and report whether the file came from human (`.<lang>.json3`) or auto
(`.<lang>.json3` produced via auto-sub) captions so the response can flag
human-vs-auto (decision 6). `json3` is chosen over VTT precisely because it
preserves clean per-cue timing for the structured contract.

**Media download today (dead):** `download.ts` `getInfo`→`ytdl()`→`ffmpeg`
pipeline writing into uncleaned `cwd()` subdirs. **Target:** a yt-dlp-backed
service exposing download tool(s) (e.g. video/audio by format+quality) that write
into a unique per-request temp dir and clean up in `finally`. Audio formats
(mp3/wav) imply yt-dlp `--extract-audio`/`--audio-format`, which requires `ffmpeg`
on the host — an additional system prerequisite to document and to guard for
absence. The tool's return value (file path vs. streamed/encoded bytes vs. handle)
is a design decision for the Plan stage, but whatever is chosen must not leave temp
artifacts behind.

**yt-dlp environment:** present on this machine at `/opt/homebrew/bin/yt-dlp`,
version `2026.06.09`, but it is a **system binary, not an npm dependency**, so a
deployed install cannot assume it exists (decision 3 → handle `ENOENT`).

**Build/runtime context:** ESM (`package.json:5`, `tsconfig` ESNext), Node v26,
`strict: false`. `node_modules` is currently NOT installed on disk, so a fresh
`npm install` is required before anything builds. Since `youtube-transcript` and
`ytdl-core` (and the phantom `fluent-ffmpeg`) are being dropped, expect
corresponding `package.json` dependency edits.

## Bugs and Issues Found
- **`language` parameter is silently ignored** — `transcript.ts:32` calls
  `YoutubeTranscript.fetchTranscript(videoId)` with no language argument, yet the
  response (`transcript.ts:34-38`) echoes back the requested/`default` `language`.
  A caller asking for `language: 'es'` can receive an English transcript labeled
  `"language": "es"`. The returned `language` field is unverified and can be a lie.
  Severity: significant (functional). The yt-dlp rewrite must actually pass
  `--sub-lang` and report the language actually fetched. (Same defect in
  `getTimestampedTranscript` `:83` and `searchTranscript` `:55`.)
- **No graceful "transcript unavailable" handling** — any failure (no captions,
  network, library breakage) is rethrown as a generic
  `Failed to get transcript: ...` (`transcript.ts:39-41`). Callers cannot
  distinguish "video has no captions" from "fetch backend is broken." Severity:
  significant (functional); the yt-dlp version should design the distinction in
  (e.g. "no captions available" vs "yt-dlp not installed" vs "fetch failed").
- **Dead download code writes uncleaned files to CWD** — `download.ts:56`/`:95`
  create `process.cwd()/downloads` and `process.cwd()/thumbnails` and never remove
  the artifacts; `getBestFormat` (`:201-217`) can also return `undefined` for an
  empty mp4 format list and index `[0]` on it. This code is unreachable today so it
  is not a live defect, but since download is now in scope (decision 4) the
  re-implementation must NOT carry these patterns forward. Severity: minor (latent
  / dead code, called out so it isn't resurrected as-is).

> NOTE (prior bug now resolved by decision 5): The DRAFT flagged the hard API-key
> startup gate (`index.ts:6-10` / `cli.ts:8-12`) as a possible bug for key-free
> transcript use. Decision 5 keeps the key requirement, so this is **not a bug** —
> the gate stays as-is and is removed from the bug list.

## Cosmetic / Design-Only (not for tests)
none — this is a backend/transport change with no user-facing presentation surface.

## Hazards
- **Boundaries & interop — yt-dlp binary presence (critical).** yt-dlp is an
  external system binary (decision 3), not an npm dep. Code must handle `ENOENT`
  (binary missing) with a clear, actionable error, and must tolerate flag evolution
  across versions (e.g. `--write-sub`/`--write-auto-sub` vs newer
  `--write-subs`/`--write-auto-subs`). Tester/planner: guard the "yt-dlp not
  installed" path and verify the flag set against the installed version
  (`2026.06.09`). Touch points: new yt-dlp transcript path replacing
  `transcript.ts:32`, and the new download service.
- **Boundaries & interop — ffmpeg presence for audio (significant, download-only).**
  yt-dlp audio extraction (mp3/wav) shells out to `ffmpeg`, an additional host
  prerequisite. Guard/document its absence so an audio-download request fails with
  a clear error rather than an opaque yt-dlp post-processing crash.
- **Boundaries & interop — command injection (critical).** `videoId` flows from
  MCP args (`server.ts:393`) toward the subprocess, and download tools add more
  user-controlled args (format, quality). Spawn via an argument array
  (`execFile`/`spawn`, never a shell string) and validate `videoId`/URL and
  enum-constrain format/quality before use. Tester must codify that a malicious
  `videoId` cannot inject shell commands.
- **Boundaries — stdout discipline / MCP stdio corruption (significant).** In stdio
  transport the JSON-RPC stream IS stdout; the repo already fought this (commit
  `4152fb9` "Fix MCP stdio protocol corruption by redirecting logs to stderr"), yet
  `server.ts` still calls `console.log` (e.g. `:84`, `:396`, `:436`) writing to
  stdout. Spawned yt-dlp MUST NOT inherit/forward its stdout to the process stdout
  — capture its stdout/stderr into buffers (especially relevant for download
  progress output). Guard: yt-dlp output never reaches the MCP stdout channel.
- **Lifetime & resources — temp files & large media (significant).** Both
  transcript subs and (especially) media downloads write files to disk. Use a
  unique temp dir per request and clean it up in a `finally` — the dead
  `download.ts:56-62`/`:95-101` write to `cwd()` with no cleanup; do not repeat
  that (decision 4). Media files can be large; consider size/time limits. Guard
  cleanup-on-error and cleanup-on-success.
- **Concurrency & reentrancy (significant).** HTTP stateless mode builds a new
  server/service per request (`server.ts:553`) and multiple transcript/download
  requests can run at once. Per-request unique temp paths/output templates are
  required so concurrent yt-dlp invocations don't collide on filenames.
- **Error & failure propagation (significant).** Subprocess integration adds new
  failure modes: non-zero exit codes, hung downloads (need a timeout/kill),
  stderr-only diagnostics, "no captions found", post-processing failures. Map these
  to meaningful, distinguishable errors rather than one generic string
  (ties to the "no graceful handling" bug above).
- **Data-contract / serialization (resolved to json3; significant to uphold).**
  Decision 2 fixes the return shape at
  `{ videoId, language, transcript: [{text, offset, duration}] }` sourced from
  yt-dlp `json3`. Parsing must map `json3` `events[].tStartMs`/`dDurationMs`/
  `segs[].utf8` onto `{text, offset(ms), duration(ms)}` without degrading timing.
  The `server.ts:51-57` result summarizer keys on `transcript`/
  `timestampedTranscript` array fields — keep those field names so the summary log
  keeps working. New download tool output needs its own serialization decision in
  Plan.
- **Dependency/ambient-decl cleanup (minor).** `youtube-transcript` and `ytdl-core`
  are each declared in `src/types/*.d.ts` AND inside `global-types.d.ts:48-91`, and
  both packages are being removed (decisions 1 + 4). Remove the stale ambient decls
  and `package.json` entries rather than leaving dangling declarations; if yt-dlp
  needs any typing, add it once, not in a third conflicting block.

## Open Questions
none — all six DRAFT questions were answered by the owner and folded into
**Decisions** above.
