# Plan: Incorporate yt-dlp support

**Issue:** #1  **Branch:** 1-incorporate-yt-dlp-support  **Date:** 2026-06-29
**Status:** APPROVED — ready for implementation

> NOTE (operator, REFINE): Consolidate the pure, side-effect-free functions into a
> single module `src/services/ytdlp.ts` and export them by these exact names and
> contracts (this is the seam the implementation must expose; the subprocess
> runner + typed errors may stay in this module or a sibling, but these four
> exports must exist with these signatures):
>   - `buildTranscriptArgs({ videoId, language }): string[]` — PURE arg builder.
>     The returned array MUST contain: `videoId` as its own discrete element
>     (never concatenated into another arg); a `--sub-lang`/`--sub-langs` flag
>     whose value contains `language`; `--sub-format` with a value containing
>     `json3`; `--skip-download`; and BOTH `--write-sub(s)` AND `--write-auto-sub(s)`
>     in the SAME invocation.
>   - `buildDownloadArgs({ videoId, format, quality }): string[]` — PURE arg builder.
>     `videoId` discrete; NO `--extract-audio`/`-x` for `mp4`; for `mp3`/`wav`
>     include `--extract-audio`/`-x` AND `--audio-format <format>`. MUST throw on
>     a format/quality outside the allowed enums (defense in depth).
>   - `isValidVideoId(id): boolean` — returns a BOOLEAN (true for canonical 11-char
>     `[A-Za-z0-9_-]` ids, false for injection payloads / empty / path separators /
>     shell metacharacters / newlines / quotes). Keep `assertValidVideoId`/`videoUrl`
>     if useful, but they must build on this boolean predicate.
>   - `parseJson3Transcript(raw): TranscriptLine[]` — as already specified (Task 1.2),
>     but EXPORTED FROM `src/services/ytdlp.ts` (not a separate parse module).
> Rework the file layout in Overview/Task 1.1/1.2/2.1/3.1 accordingly: the
> transcript and download services must CALL `buildTranscriptArgs`/`buildDownloadArgs`
> rather than inlining their arg arrays.
>
> RESOLVED: Layout collapsed to a single module `src/services/ytdlp.ts` (the
> first option the NOTE offers) — it now exports `buildTranscriptArgs`,
> `buildDownloadArgs`, `isValidVideoId`, `parseJson3Transcript` (the four mandated,
> with these exact signatures), plus `assertValidVideoId`/`videoUrl` (built on the
> boolean predicate), the runner `runYtDlp`, and the typed errors
> `YtDlpNotInstalledError`/`YtDlpFailedError`. The prior `ytdlp-command.ts` and
> `ytdlp-transcript-parse.ts` modules are gone. `transcript.ts` now CALLS
> `buildTranscriptArgs`; `download.ts` now CALLS `buildDownloadArgs` (Tasks 1.1,
> 1.2, 2.1, 3.1). Per-flag arg arrays are no longer inlined in either service.
> The build functions emit `videoId` as a bare discrete trailing element (not the
> watch URL — that would concatenate it into another arg); `videoId` validity is
> enforced in the service layer via `assertValidVideoId` (built on `isValidVideoId`),
> which keeps the locked build-fn signatures intact while still closing the
> injection seam. See "videoId validation seam" in Open Questions.
>
> NOTE (operator, REFINE): Because `buildTranscriptArgs` now requests human AND
> auto subs in ONE invocation, the Phase 2 two-phase (one-flag-per-call) strategy
> no longer holds. Rework Task 2.1 to use the single combined invocation and derive
> the `kind: 'human' | 'auto'` flag another way — e.g. from yt-dlp's captured
> stdout/stderr ("Writing video subtitles" vs "Writing video auto subtitles") or
> another reliable signal — rather than from two separate single-flag runs. Keep
> the per-request temp dir + `finally` cleanup, the honored/reported `language`
> fix, and the three distinct error categories.
>
> RESOLVED: Task 2.1 reworked. `fetchTranscript` now does ONE combined
> `buildTranscriptArgs` invocation (both `--write-subs` and `--write-auto-subs`),
> writing into the per-request temp dir, and derives `kind` from yt-dlp's captured
> stdout/stderr: the human line `Writing video subtitles` ⇒ `kind: 'human'`
> (preferred when both appear); only `Writing video auto subtitles` present ⇒
> `kind: 'auto'`. The per-request `mkdtemp` + `finally` cleanup, the
> honored-and-reported `language` (read from the produced filename), and the three
> distinct error categories all remain. See Task 2.1.

## Open Questions / Locked-surface conflicts
None blocking. Resolved-here design points the implementer should be aware of:
- **Module layout (operator NOTE 1).** All pure helpers + the runner + typed
  errors live in one `src/services/ytdlp.ts`. The four mandated exports use the
  exact signatures the NOTE specifies. Resolved above.
- **videoId validation seam.** The locked build-fn signatures
  (`buildTranscriptArgs`/`buildDownloadArgs`) take a bare `videoId` and emit it as
  a discrete element; they do NOT throw on a malformed `videoId` (that would change
  their contract and could trip the pure-arg suites). `videoId` injection rejection
  is the job of `isValidVideoId`; the transcript/download SERVICES call
  `assertValidVideoId(videoId)` (built on the predicate) before invoking the runner.
  This pushes the validation concern to the service layer without altering any
  locked surface.
- **`kind` derivation (operator NOTE 2).** Single combined invocation; `kind`
  derived from captured stdout/stderr. Resolved above and in Task 2.1.
- **Download return shape (RESEARCH left to Plan).** Resolved to *inline base64*
  content + metadata, with a size cap, because decision 4 mandates a per-request
  temp dir cleaned in `finally` — a returned file path cannot survive that
  cleanup, so the bytes must be returned inline. See Task 3.1.
- **Human-vs-auto field name (decision 6, name not locked by RESEARCH).** Resolved
  to an added `kind: 'human' | 'auto'` field on the transcript result. This is
  *additive* — the locked three-key shape `{ videoId, language, transcript }` is
  preserved byte-for-byte. Flagged in Task 2.1 Risks.

## Overview
Replace the `youtube-transcript` library with a `yt-dlp`-backed transcript path,
add a `yt-dlp`-backed media/audio download tool, and treat `yt-dlp` (plus
`ffmpeg` for audio) as documented host prerequisites. All subprocess calls go
through one hardened runner (`execFile`, array args, captured stdout/stderr,
ENOENT/timeout/exit mapping). Argument arrays are produced by **pure** builder
functions (`buildTranscriptArgs`/`buildDownloadArgs`) so they are unit-testable
without a subprocess and so neither service inlines its own arg array. Per-request
temp dirs are used everywhere and removed in `finally`. The YouTube API-key
startup gate is left untouched (decision 5).

New modules:
- `src/services/ytdlp.ts` — single consolidated module:
  - subprocess runner `runYtDlp` + typed errors `YtDlpNotInstalledError` /
    `YtDlpFailedError`;
  - `videoId` validation: `isValidVideoId(id): boolean` plus
    `assertValidVideoId`/`videoUrl` built on it;
  - pure arg builders `buildTranscriptArgs` / `buildDownloadArgs`;
  - pure `json3` → `TranscriptLine[]` parser `parseJson3Transcript`.
- `src/services/download.ts` — `DownloadService` (media/audio download tool backend),
  CALLS `buildDownloadArgs`.

Modified: `src/services/transcript.ts` (CALLS `buildTranscriptArgs`), `src/server.ts`,
`src/types.ts`, `package.json`, the ambient `.d.ts` decls, `README.md`, `CLAUDE.md`.

**Out of scope:** thumbnail extraction and `getDownloadOptions` from the dead
sketch (only media/audio *download* is in scope per decision 4); keyless mode
(decision 5); any change to `src/functions/**` other than deleting the replaced
`content/download.ts` sketch.

**Setup prerequisite (run once before Phase 1).** `node_modules` is not on disk
(RESEARCH build/runtime note). Run `npm install` before any build/test command.

## Phase 1: yt-dlp foundation (one consolidated module + types)

### Task 1.1: Create `src/services/ytdlp.ts` — runner, errors, validation, arg builders
**Files:** create `src/services/ytdlp.ts`
**Existing logic:** none (new). Pattern reference: services are lightweight,
stateless classes/functions (`src/services/youtube-client.ts`).
**Approach:** One module that exposes the whole yt-dlp seam.
- **Runner:** Wrap `execFile` (promisified) so callers pass an **argument array**
  (never a shell string) — closes the command-injection hazard. `execFile`
  captures `stdout`/`stderr` into buffers and does **not** inherit the process
  stdio, satisfying the stdout-discipline hazard (yt-dlp output never reaches the
  MCP stdio channel). Map failures to distinct typed errors: missing binary
  (`ENOENT`) → `YtDlpNotInstalledError`; timeout/kill or non-zero exit →
  `YtDlpFailedError` (carrying exit code + captured stderr). Binary path
  overridable via `YTDLP_PATH` (defaults to `yt-dlp` on PATH). The runner accepts
  a `cwd` option so callers can direct output into a per-request temp dir.
- **Validation:** `isValidVideoId(id)` returns a **boolean** via
  `^[A-Za-z0-9_-]{11}$` (rejects empty, path separators, shell metacharacters,
  newlines, quotes, and non-strings). `assertValidVideoId` and `videoUrl` build
  on that predicate.
- **Arg builders (PURE):** `buildTranscriptArgs`/`buildDownloadArgs` return arg
  arrays with `videoId` as a discrete trailing element (never folded into a URL).
  They include a **relative** `-o %(id)s.%(ext)s` output template so the runner's
  `cwd` (a temp dir) determines where files land while keeping the builders pure
  (dir-independent). `buildDownloadArgs` throws on a format/quality outside the
  allowed enums (defense in depth on top of `execFile` array args).
**Proposed change:**
```typescript
// New file: src/services/ytdlp.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TranscriptLine, DownloadFormat, DownloadQuality } from '../types.js';

const execFileAsync = promisify(execFile);
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export class YtDlpNotInstalledError extends Error {
  constructor(bin: string) {
    super(`yt-dlp executable not found ("${bin}"). Install yt-dlp and ensure it is on PATH (or set YTDLP_PATH). See README prerequisites.`);
    this.name = 'YtDlpNotInstalledError';
  }
}

export class YtDlpFailedError extends Error {
  constructor(message: string, public readonly exitCode: number | null, public readonly stderr: string) {
    super(message);
    this.name = 'YtDlpFailedError';
  }
}

export function isValidVideoId(id: unknown): boolean {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

export function assertValidVideoId(videoId: string): void {
  if (!isValidVideoId(videoId)) {
    throw new Error('Invalid videoId: expected 11 characters of [A-Za-z0-9_-].');
  }
}

export function videoUrl(videoId: string): string {
  assertValidVideoId(videoId);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildTranscriptArgs(
  { videoId, language }: { videoId: string; language: string }
): string[] {
  return [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', language,
    '--sub-format', 'json3',
    '-o', '%(id)s.%(ext)s',
    videoId,
  ];
}

const DOWNLOAD_FORMATS = new Set<DownloadFormat>(['mp4', 'mp3', 'wav']);
const DOWNLOAD_QUALITIES = new Set<DownloadQuality>(['highest', 'lowest', '1080p', '720p', '480p', '360p']);
const AUDIO_FORMATS = new Set<DownloadFormat>(['mp3', 'wav']);

function videoFormatSelector(quality: DownloadQuality): string {
  if (quality === 'highest') return 'bv*+ba/b';
  if (quality === 'lowest') return 'wv*+wa/w';
  const h = parseInt(quality, 10);                  // e.g. '720p' -> 720
  return `bv*[height<=${h}]+ba/b[height<=${h}]`;
}

export function buildDownloadArgs(
  { videoId, format = 'mp4', quality = 'highest' }:
    { videoId: string; format?: DownloadFormat; quality?: DownloadQuality }
): string[] {
  if (!DOWNLOAD_FORMATS.has(format as DownloadFormat)) throw new Error(`Unsupported format: ${String(format)}`);
  if (!DOWNLOAD_QUALITIES.has(quality as DownloadQuality)) throw new Error(`Unsupported quality: ${String(quality)}`);
  if (AUDIO_FORMATS.has(format)) {
    return ['--extract-audio', '--audio-format', format, '-o', '%(id)s.%(ext)s', videoId];
  }
  return ['-f', videoFormatSelector(quality), '--merge-output-format', 'mp4', '-o', '%(id)s.%(ext)s', videoId];
}

export interface YtDlpResult { stdout: string; stderr: string; }

export async function runYtDlp(
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {}
): Promise<YtDlpResult> {
  const { timeoutMs = 60_000, cwd } = options;
  try {
    const { stdout, stderr } = await execFileAsync(YTDLP_BIN, args, {
      timeout: timeoutMs,
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    });
    return { stdout, stderr };
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new YtDlpNotInstalledError(YTDLP_BIN);
    if (err?.killed) throw new YtDlpFailedError(`yt-dlp timed out after ${timeoutMs}ms`, null, err?.stderr ?? '');
    throw new YtDlpFailedError(
      `yt-dlp exited with code ${err?.code ?? 'unknown'}`,
      typeof err?.code === 'number' ? err.code : null,
      err?.stderr ?? ''
    );
  }
}
```
**Assumptions / Risks:** Installed yt-dlp is `2026.06.09`, which uses the
**plural** flag forms (`--write-subs`, `--write-auto-subs`, `--sub-langs`,
`--extract-audio`); verify these against the installed version (flag-evolution
hazard). The builders emit the **bare** `videoId` as the final discrete arg;
yt-dlp's YouTube extractor accepts a bare 11-char id. A canonical id may legally
begin with `-` (the char class allows it); passed as a discrete arg it could be
read as a flag. This is a robustness (not injection) edge — `execFile` array args
already block shell injection. Verify behavior for a `-`-prefixed id during
implementation; if mis-parsed, insert a `--` end-of-options sentinel immediately
before `videoId` in both builders (additive; keeps `videoId` discrete). `execFile`
captures output rather than inheriting stdio — do not switch to `spawn` with
`stdio: 'inherit'`, which would corrupt the MCP stdout channel. `maxBuffer` guards
huge stdout; media bytes go to disk via the `-o` template + `cwd`, not stdout, so
64 MB is ample.

### Task 1.2: Add the json3 parser to `src/services/ytdlp.ts`
**Files:** modify `src/services/ytdlp.ts` (append; same module created in Task 1.1)
**Existing logic:** RESEARCH "Transcript target (json3)" — map `events[]`
(`tStartMs`, `dDurationMs`, `segs[].utf8`) onto `{text, offset(ms), duration(ms)}`.
**Approach:** Pure, side-effect-free function (unit-testable without a subprocess),
exported from `src/services/ytdlp.ts` per operator NOTE (no separate parse module).
Concatenate each event's `segs[].utf8`, trim, skip empty/timing-only events, and
emit `TranscriptLine` with `offset = tStartMs`, `duration = dDurationMs`. Upholds
the locked data contract (decision 2) without degrading per-cue timing.
**Proposed change:**
```typescript
// Append to src/services/ytdlp.ts
interface Json3Seg { utf8?: string; }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[]; }

export function parseJson3Transcript(raw: string): TranscriptLine[] {
  const data = JSON.parse(raw) as { events?: Json3Event[] };
  const events = Array.isArray(data.events) ? data.events : [];
  const lines: TranscriptLine[] = [];
  for (const ev of events) {
    if (!Array.isArray(ev.segs)) continue;
    const text = ev.segs.map((s) => s.utf8 ?? '').join('').trim();
    if (!text) continue;
    lines.push({ text, offset: ev.tStartMs ?? 0, duration: ev.dDurationMs ?? 0 });
  }
  return lines;
}
```
**Assumptions / Risks:** `offset`/`duration` are milliseconds (preserves the
existing line shape that `getTimestampedTranscript` divides by 1000). Malformed
JSON throws from `JSON.parse` — the transcript service maps that to a backend
failure (Task 2.1), not "unavailable".

### Task 1.3: Add shared types
**Files:** modify `src/types.ts`  ·  **Existing logic:** `src/types.ts:48-60`
(`TranscriptParams`, `SearchTranscriptParams` — keep as-is).
**Approach:** `TranscriptLine` previously came from the `youtube-transcript`
ambient module (removed in Phase 4); relocate it here. Add the transcript result
type (locked three keys + additive `kind`) and download param/format types
(enum-constrained to satisfy the injection hazard and to back `buildDownloadArgs`'
throw-on-bad-enum contract).
**Proposed change:**
```typescript
// Append to src/types.ts
export interface TranscriptLine {
  text: string;
  offset: number;   // milliseconds
  duration: number; // milliseconds
}

export type TranscriptKind = 'human' | 'auto';

export interface TranscriptResult {
  videoId: string;
  language: string;            // language ACTUALLY fetched (fixes silent-ignore bug)
  kind: TranscriptKind;        // human captions vs auto-generated (decision 6)
  transcript: TranscriptLine[];
}

export type DownloadFormat = 'mp4' | 'mp3' | 'wav';
export type DownloadQuality = 'highest' | 'lowest' | '1080p' | '720p' | '480p' | '360p';

export interface DownloadMediaParams {
  videoId: string;
  format?: DownloadFormat;
  quality?: DownloadQuality;
}
```
**Assumptions / Risks:** `TranscriptResult` keeps `transcript` as its array key so
`summarizeResult` (`src/server.ts:51-57`) keeps logging it. `kind` is additive;
the locked `{ videoId, language, transcript }` keys remain present. `DownloadFormat`
/`DownloadQuality` are imported by `ytdlp.ts` (Task 1.1) to type the builder enums.

### Test Gate 1
**Run before continuing.** The implementer runs the pre-written suites for the
new foundation module and proceeds only on Green:
- Command: `npm install` (once), then `npm test -- ytdlp-command ytdlp-transcript-parse`
- Expected: the `ytdlp-command` (arg builders + `videoId` validation) and
  `ytdlp-transcript-parse` (json3 parser) suites pass; no regressions. (Both suites
  import from `src/services/ytdlp.ts` — the test file names are unrelated to the
  consolidated source module.)

Checklist:
- [ ] **Task 1.1:** create `src/services/ytdlp.ts` with runner, typed errors, validation, and arg builders
  - [ ] `runYtDlp` (execFile array args, captured stdout/stderr, `cwd`/timeout, ENOENT/kill/exit mapping)
  - [ ] `YtDlpNotInstalledError`, `YtDlpFailedError`
  - [ ] `isValidVideoId` (boolean), `assertValidVideoId`, `videoUrl`
  - [ ] `buildTranscriptArgs` (both sub flags, `--sub-langs`, `--sub-format json3`, `--skip-download`, discrete `videoId`)
  - [ ] `buildDownloadArgs` (mp4 vs mp3/wav branches, throws on bad enum, discrete `videoId`)
- [ ] **Task 1.2:** append `parseJson3Transcript` to `src/services/ytdlp.ts`
- [ ] **Task 1.3:** add `TranscriptLine`, `TranscriptKind`, `TranscriptResult`, `DownloadFormat`, `DownloadQuality`, `DownloadMediaParams` to `src/types.ts`
- [ ] **Test Gate 1:** `npm install`, then `npm test -- ytdlp-command ytdlp-transcript-parse` → Green

## Phase 2: Rewire TranscriptService onto yt-dlp

### Task 2.1: Replace the library call in `getTranscript` (single combined invocation)
**Files:** modify `src/services/transcript.ts`
**Existing logic:** `src/services/transcript.ts:24-42` (`getTranscript`),
`:1` (`youtube-transcript` import to delete).
**Approach:** Drop the `youtube-transcript` import. Add a private
`fetchTranscript(videoId, language)` helper that, **per request**:
1. Validates `videoId` via `assertValidVideoId` (service-layer injection guard).
2. Creates a unique temp dir (`mkdtemp` under `os.tmpdir()` — concurrency/temp-file
   hazards).
3. Runs **one** `buildTranscriptArgs({ videoId, language })` invocation — which
   requests **both** human and auto subs in the same call — through `runYtDlp`
   with `cwd: dir`, so the relative `-o %(id)s.%(ext)s` template lands files in the
   temp dir. Captures stdout/stderr.
4. Locates the produced `*.json3` file, parses it (Task 1.2).
5. Derives `kind` from the captured output rather than from separate single-flag
   runs (operator NOTE 2): the human line `Writing video subtitles` ⇒
   `kind: 'human'` (preferred when both lines appear, since human is requested
   first); only the auto line `Writing video auto subtitles` ⇒ `kind: 'auto'`.
   (`/Writing video subtitles/` does not match the auto line, whose wording is
   "Writing video **auto** subtitles".)
6. Reports the language **actually** read from the produced filename (fixes the
   silent-ignore bug).
7. Cleans the dir in `finally` (success **and** error).

Map errors into three distinct categories (fixes the "no graceful handling" bug):
`YtDlpNotInstalledError` → propagate its actionable message; no usable subs (no
`*.json3` file, or zero parsed lines) → `TranscriptUnavailableError` ("no captions
available"); any other failure → `Failed to get transcript: ...`.
**Proposed change:**
```typescript
// src/services/transcript.ts — new imports (replacing the youtube-transcript import)
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runYtDlp, buildTranscriptArgs, parseJson3Transcript, assertValidVideoId,
  YtDlpNotInstalledError,
} from './ytdlp.js';
import {
  TranscriptParams, SearchTranscriptParams, TranscriptLine, TranscriptKind,
} from '../types.js';

export class TranscriptUnavailableError extends Error {
  constructor(videoId: string, language: string) {
    super(`No transcript available for video "${videoId}" in language "${language}".`);
    this.name = 'TranscriptUnavailableError';
  }
}

// private helper on TranscriptService
private async fetchTranscript(
  videoId: string,
  language: string
): Promise<{ lines: TranscriptLine[]; kind: TranscriptKind; language: string }> {
  assertValidVideoId(videoId);
  const dir = await mkdtemp(join(tmpdir(), 'yt-transcript-'));
  try {
    const { stdout, stderr } = await runYtDlp(
      buildTranscriptArgs({ videoId, language }),
      { timeoutMs: 60_000, cwd: dir }
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json3'));
    if (files.length === 0) throw new TranscriptUnavailableError(videoId, language);
    const file = files.find((f) => f.includes(`.${language}.`)) ?? files[0];
    const lines = parseJson3Transcript(await readFile(join(dir, file), 'utf8'));
    if (lines.length === 0) throw new TranscriptUnavailableError(videoId, language);
    const parts = file.split('.');                 // <id>.<lang>.json3
    const fetched = parts.length >= 3 ? parts[parts.length - 2] : language;
    const out = `${stdout}\n${stderr}`;
    const kind: TranscriptKind = /Writing video subtitles/.test(out) ? 'human' : 'auto';
    return { lines, kind, language: fetched };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async getTranscript({
  videoId,
  language = process.env.YOUTUBE_TRANSCRIPT_LANG || 'en',
}: TranscriptParams): Promise<any> {
  try {
    const { lines, kind, language: fetched } = await this.fetchTranscript(videoId, language);
    return { videoId, language: fetched, kind, transcript: lines };
  } catch (error) {
    if (error instanceof YtDlpNotInstalledError || error instanceof TranscriptUnavailableError) {
      throw error; // preserve the distinct, actionable message
    }
    throw new Error(`Failed to get transcript: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```
[`initialize()`/`initialized` plumbing at `:9-19` is now vestigial; it may be left
in place or removed — no behavior depends on it. Removing it is the tidier choice
but not required for Green.]
**Assumptions / Risks:** `kind` field name is a planner choice (decision 6 fixes
the *behavior*, not the field name) — flagged in Open Questions; the locked
`{ videoId, language, transcript }` keys are preserved. With both `--write-subs`
and `--write-auto-subs` set for the same `--sub-langs`, yt-dlp may write a human
file, an auto file, or — if both are available for the same language — collide on
the same `<id>.<lang>.json3` name so only one survives on disk; `kind` is taken
from stdout (preferring human) and may not match the surviving file in that rare
both-available case. Verify against `2026.06.09`: confirm the exact stdout wording
("Writing video subtitles" vs "Writing video auto subtitles") and the
human/auto filename behavior; if they collide, prefer parsing the human filename
named in the `Writing video subtitles to: <file>` line (a more precise signal the
NOTE explicitly allows). yt-dlp filename template `%(id)s.%(ext)s` yields
`<id>.<lang>.json3`; the `.<lang>.` match and the `parts[-2]` language extraction
depend on that shape. If yt-dlp exits non-zero on a no-subtitle video (rather than
exiting 0 with no file), `YtDlpFailedError` surfaces as a generic "Failed to get
transcript" rather than "unavailable" — an acceptable degradation; verify during
implementation.

### Task 2.2: Repoint `searchTranscript` and `getTimestampedTranscript`
**Files:** modify `src/services/transcript.ts`
**Existing logic:** `:47-71` (`searchTranscript`, calls `fetchTranscript` at `:55`),
`:76-108` (`getTimestampedTranscript`, calls at `:83`). Neither is wired into
`server.ts` (unreachable as tools) but both must keep compiling once the library
is gone (RESEARCH).
**Approach:** Route both through the same private `fetchTranscript` helper.
Preserve their existing return field names — `matches`/`totalMatches` for search,
and `timestampedTranscript` for the timestamped variant (the latter keyed on by
`summarizeResult` at `src/server.ts:55`). Report the actually-fetched language and
`kind` on both. Keep the `mm:ss` formatting math (`offset / 1000`) unchanged.
**Proposed change:**
```typescript
async searchTranscript({
  videoId, query,
  language = process.env.YOUTUBE_TRANSCRIPT_LANG || 'en',
}: SearchTranscriptParams): Promise<any> {
  try {
    const { lines, kind, language: fetched } = await this.fetchTranscript(videoId, language);
    const matches = lines.filter((item) => item.text.toLowerCase().includes(query.toLowerCase()));
    return { videoId, query, language: fetched, kind, matches, totalMatches: matches.length };
  } catch (error) {
    if (error instanceof YtDlpNotInstalledError || error instanceof TranscriptUnavailableError) throw error;
    throw new Error(`Failed to search transcript: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async getTimestampedTranscript({
  videoId,
  language = process.env.YOUTUBE_TRANSCRIPT_LANG || 'en',
}: TranscriptParams): Promise<any> {
  try {
    const { lines, kind, language: fetched } = await this.fetchTranscript(videoId, language);
    const timestampedTranscript = lines.map((item) => {
      const seconds = item.offset / 1000;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.floor(seconds % 60);
      return {
        timestamp: `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`,
        text: item.text,
        startTimeMs: item.offset,
        durationMs: item.duration,
      };
    });
    return { videoId, language: fetched, kind, timestampedTranscript };
  } catch (error) {
    if (error instanceof YtDlpNotInstalledError || error instanceof TranscriptUnavailableError) throw error;
    throw new Error(`Failed to get timestamped transcript: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```
**Assumptions / Risks:** none — these stay unexposed; the change is purely to keep
them compiling and consistent after the library removal.

### Test Gate 2
**Run before continuing.**
- Command: `npm run build` then `npm test`
- Expected: TypeScript compiles with no errors; transcript-related suites pass; no regressions in the rest of the suite.

Checklist:
- [ ] **Task 2.1:** rewrite `getTranscript` + add `fetchTranscript`
  - [ ] delete the `youtube-transcript` import; add the `ytdlp.js` + `node:fs/promises`/`os`/`path` imports
  - [ ] `assertValidVideoId` at entry; `mkdtemp` temp dir; `finally` cleanup
  - [ ] single `buildTranscriptArgs` invocation via `runYtDlp({ cwd: dir })`
  - [ ] derive `kind` from captured stdout/stderr; report fetched `language` from filename
  - [ ] three error categories (`YtDlpNotInstalledError`, `TranscriptUnavailableError`, generic)
  - [ ] add `TranscriptUnavailableError` class
- [ ] **Task 2.2:** repoint `searchTranscript` and `getTimestampedTranscript` through `fetchTranscript`, preserving `matches`/`totalMatches`/`timestampedTranscript` keys
- [ ] **Test Gate 2:** `npm run build` then `npm test` → Green

## Phase 3: yt-dlp media/audio download tool

### Task 3.1: New `DownloadService` (calls `buildDownloadArgs`)
**Files:** create `src/services/download.ts`
**Existing logic (conceptual model only — do NOT reuse):**
`src/functions/content/download.ts:45-74` (`downloadVideo`). Drop its
`process.cwd()/downloads` no-cleanup pattern (`:56`) and `ytdl-core`/`fluent-ffmpeg`
deps entirely.
**Approach:** Validate `videoId` via `assertValidVideoId`. Build the arg array by
**calling** `buildDownloadArgs({ videoId, format, quality })` (Task 1.1) — which
enum-constrains `format`/`quality` and throws on anything outside the allowed sets
(injection hazard, defense in depth) and emits the relative `-o %(id)s.%(ext)s`
template. Create a per-request unique temp dir (`mkdtemp`) and run yt-dlp with
`cwd: dir`, so output lands there; clean the dir in `finally` (temp-file +
concurrency hazards). Apply a download timeout (`YTDLP_DOWNLOAD_TIMEOUT_MS`,
default 300 s) to guard hung downloads. Read the produced file, enforce a size cap
(`YTDLP_MAX_DOWNLOAD_BYTES`, default 50 MB), and return the bytes **inline as
base64** plus metadata — the temp file is deleted in `finally`, so a path return
would dangle (see Open Questions). If an audio download fails with an
ffmpeg/post-processing error, surface the actionable "ffmpeg is required" message
(ffmpeg-presence hazard).
**Proposed change:**
```typescript
// New file: src/services/download.ts
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runYtDlp, buildDownloadArgs, assertValidVideoId, YtDlpFailedError } from './ytdlp.js';
import { DownloadMediaParams, DownloadFormat } from '../types.js';

const AUDIO = new Set<DownloadFormat>(['mp3', 'wav']);
const MAX_BYTES = Number(process.env.YTDLP_MAX_DOWNLOAD_BYTES || 50 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 300_000);

export class DownloadService {
  async downloadMedia({ videoId, format = 'mp4', quality = 'highest' }: DownloadMediaParams): Promise<any> {
    assertValidVideoId(videoId);                       // service-layer injection guard
    const args = buildDownloadArgs({ videoId, format, quality }); // throws on bad enum
    const dir = await mkdtemp(join(tmpdir(), 'yt-download-'));
    try {
      try {
        await runYtDlp(args, { timeoutMs: TIMEOUT_MS, cwd: dir });
      } catch (err) {
        if (AUDIO.has(format) && err instanceof YtDlpFailedError && /ffmpeg|ffprobe|postprocess/i.test(err.stderr)) {
          throw new Error('ffmpeg is required for audio downloads (mp3/wav). Install ffmpeg on the host. See README prerequisites.');
        }
        throw err;
      }
      const file = (await readdir(dir))[0];
      if (!file) throw new Error('Download produced no output file.');
      const full = join(dir, file);
      const { size } = await stat(full);
      if (size > MAX_BYTES) {
        throw new Error(`Downloaded file is ${size} bytes, exceeding the ${MAX_BYTES}-byte limit (set YTDLP_MAX_DOWNLOAD_BYTES to raise it).`);
      }
      const data = await readFile(full);
      return { videoId, format, quality, filename: file, sizeBytes: size, contentBase64: data.toString('base64') };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
```
**Assumptions / Risks:** `format`/`quality` enum enforcement now lives in
`buildDownloadArgs` (single source of truth); the service keeps the `AUDIO` set
only to recognize the audio path for ffmpeg-error mapping. Inline base64 keeps the
no-artifacts guarantee but bounds usefulness for large video — hence the default
50 MB cap; document this. yt-dlp output goes to disk (`-o` template + `cwd`), and
`runYtDlp` captures any stdout/stderr, so MCP stdout stays clean even with download
progress. The `bv*+ba` selector merges via ffmpeg, a video-path dependency too;
the explicit ffmpeg error mapping covers the audio case — verify a merge failure
also yields a clear error during implementation.

### Task 3.2: Register and route the download tool in the MCP server
**Files:** modify `src/server.ts`
**Existing logic:** tool defs `src/server.ts:86-388` (`ListToolsRequestSchema`);
service construction `:78-81`; routing switch `:401-434`; type imports `:14-25`.
**Approach:** Import `DownloadService` and `DownloadMediaParams`, construct the
service alongside the others, add a `downloads_downloadMedia` tool definition to
the `tools` array, and add a routing `case`. Tool name follows the existing
`{service}_{operation}` convention (`videos_getVideo`, `transcripts_getTranscript`).
No change to the locked `transcripts_getTranscript` definition (`:171-187`) or its
routing (`:408-409`).
**Proposed change:**
```typescript
// imports (extend the existing import lists)
import { DownloadService } from './services/download.js';
import { /* …existing… */ DownloadMediaParams } from './types.js';

// in createMcpServer(), beside the other services
const downloadService = new DownloadService();

// add to the tools array in ListToolsRequestSchema
{
  name: 'downloads_downloadMedia',
  description: 'Download a YouTube video or extract its audio via yt-dlp (returns base64-encoded media). Requires yt-dlp on the host; audio formats also require ffmpeg.',
  inputSchema: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'The YouTube video ID' },
      format: { type: 'string', enum: ['mp4', 'mp3', 'wav'], description: 'Output format (default mp4)' },
      quality: { type: 'string', enum: ['highest', 'lowest', '1080p', '720p', '480p', '360p'], description: 'Video quality (ignored for audio formats; default highest)' },
    },
    required: ['videoId'],
  },
},

// add to the CallToolRequestSchema switch
case 'downloads_downloadMedia':
  result = await downloadService.downloadMedia(args as unknown as DownloadMediaParams);
  break;
```
**Assumptions / Risks:** HTTP stateless mode builds a fresh server + services per
request (`src/server.ts:553`); `DownloadService`/`TranscriptService` are cheap,
stateless constructs, so per-request construction is fine (concurrency hazard).
`summarizeResult` will log this result as `object(keys=videoId,format,quality,
filename,sizeBytes,contentBase64)` — keys only, so the base64 blob is not dumped
to the log.

### Test Gate 3
**Run before continuing.**
- Command: `npm run build` then `npm test`
- Expected: compiles; full suite stays Green (the download path has no dedicated
  pre-written suite, so this gate confirms no regressions and a clean build).

Checklist:
- [ ] **Task 3.1:** create `src/services/download.ts`
  - [ ] `assertValidVideoId` at entry; call `buildDownloadArgs` (no inlined arg array)
  - [ ] per-request `mkdtemp` + `runYtDlp({ cwd, timeoutMs })` + `finally` cleanup
  - [ ] ffmpeg-error mapping for audio; size cap; inline base64 return shape
- [ ] **Task 3.2:** register `downloads_downloadMedia` tool def + routing case in `src/server.ts`; construct `DownloadService`; import `DownloadMediaParams`
- [ ] **Test Gate 3:** `npm run build` then `npm test` → Green

## Phase 4: Dependency / ambient-decl cleanup and docs

### Task 4.1: Remove dropped npm dependencies
**Files:** modify `package.json`  ·  **Existing logic:** `package.json:27-28`
(`youtube-transcript`, `ytdl-core`).
**Approach:** Delete the `youtube-transcript` and `ytdl-core` dependency entries.
`fluent-ffmpeg` is referenced in `src/functions/**` but is **not** a declared
dependency (RESEARCH) — nothing to remove there. After editing, re-run `npm install`
to refresh the lockfile/`node_modules`.
**Proposed change:** Remove these two lines from `dependencies`:
```json
"youtube-transcript": "^1.0.6",
"ytdl-core": "^4.11.5"
```
**Assumptions / Risks:** Many excluded `src/functions/**` files still `import`
`youtube-transcript`/`ytdl-core`/`fluent-ffmpeg`. They are excluded from
compilation (`tsconfig.json:29-32`) and unimported by the build, so removing the
deps does **not** break `npm run build`. Do not attempt to fix those dead files —
out of scope.

### Task 4.2: Remove stale ambient module declarations
**Files:** delete `src/types/youtube-transcript.d.ts`; delete `src/types/ytdl.d.ts`;
modify `src/types/global-types.d.ts`.
**Existing logic:** `src/types/youtube-transcript.d.ts` (whole file = the
`youtube-transcript` decl); `src/types/ytdl.d.ts` (whole file = `ytdl-core` decl);
the duplicate `youtube-transcript` block at `global-types.d.ts:44-57` and the
`ytdl-core` block at `:59-77`.
**Approach:** Delete the two dedicated `.d.ts` files. In `global-types.d.ts`,
remove only the `youtube-transcript` and `ytdl-core` `declare module` blocks; leave
the `google` namespace and the `fs/promises` extension untouched (they serve the
excluded functions and removing them is out of scope). `TranscriptLine` now lives
in `src/types.ts` (Task 1.3), so no compiled code depends on the removed decls.
**Proposed change:** `New file: none.` Deletions + targeted block removals as above.
**Assumptions / Risks:** Confirm no compiled file (`src/services/**`, `index.ts`,
`server.ts`, `cli.ts`, `types.ts`) imports `youtube-transcript`/`ytdl-core` after
Phase 2 — verified: the only compiled consumer was `transcript.ts:1`, removed in
Task 2.1.

### Task 4.3: Delete the replaced download sketch
**Files:** delete `src/functions/content/download.ts`
**Existing logic:** `src/functions/content/download.ts:32-218` — the dead
`ytdl-core`/`fluent-ffmpeg` sketch decision 4 says is replaced.
**Approach:** Remove the file; its capability now lives in `src/services/download.ts`.
**Assumptions / Risks:** File is excluded/unimported, so deletion is build-neutral.
Other `src/functions/content/*` dead files are left as-is (out of scope).

### Task 4.4: Document host prerequisites and the new tool
**Files:** modify `README.md`, `CLAUDE.md`
**Existing logic:** `README.md:88` (Installation), `:142-149` (Configuration),
tools table `:8-21`; `CLAUDE.md` "Development Commands" / "Available Tools" /
"Configuration" sections.
**Approach:**
- README: add a **Prerequisites** subsection stating `yt-dlp` is required for
  transcripts and downloads, and `ffmpeg` is required for audio (mp3/wav) downloads
  and for merged video; note the clear ENOENT error if yt-dlp is missing and the
  optional `YTDLP_PATH` override. Add `downloads_downloadMedia` to the tools table
  and the per-tool parameters section. Update the `transcripts_getTranscript`
  description to note the response now reports the actual `language` and a `kind`
  (human vs auto) field. Note the optional `YTDLP_MAX_DOWNLOAD_BYTES` /
  `YTDLP_DOWNLOAD_TIMEOUT_MS` env vars.
- CLAUDE.md: add yt-dlp + ffmpeg to prerequisites/notes and list the new tool in
  "Available Tools"; note the transcript backend is now yt-dlp (not
  `youtube-transcript`).
**Proposed change:** Documentation prose only (no code). Example README snippet:
```markdown
## Prerequisites
- Node.js (ESM, Node 18+)
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` (or set `YTDLP_PATH`) —
  required for `transcripts_getTranscript` and `downloads_downloadMedia`.
- [`ffmpeg`](https://ffmpeg.org/) on `PATH` — required for audio downloads
  (`mp3`/`wav`) and merged-format video.
```
**Assumptions / Risks:** none — docs only; verify the tool count ("currently
exposes N MCP tools") is bumped to include `downloads_downloadMedia`.

### Test Gate 4
**Run before continuing (final gate).**
- Command: `npm install` (after dep removal), `npm run build`, `npm test`
- Expected: install succeeds without the removed packages; build is clean; the
  entire pre-written suite is Green with no regressions.

Checklist:
- [ ] **Task 4.1:** remove `youtube-transcript` + `ytdl-core` from `package.json`; `npm install`
- [ ] **Task 4.2:** delete `src/types/youtube-transcript.d.ts` + `src/types/ytdl.d.ts`; remove the two `declare module` blocks from `global-types.d.ts`
- [ ] **Task 4.3:** delete `src/functions/content/download.ts`
- [ ] **Task 4.4:** update `README.md` (Prerequisites, tools table, env vars) and `CLAUDE.md` (prerequisites, Available Tools, transcript backend note)
- [ ] **Test Gate 4:** `npm install`, `npm run build`, `npm test` → Green

## Self-check (APPROVED)
- **Operator NOTEs addressed:** (1) all four pure exports consolidated into
  `src/services/ytdlp.ts` with the exact mandated signatures; services CALL
  `buildTranscriptArgs`/`buildDownloadArgs` (Tasks 1.1, 2.1, 3.1) instead of
  inlining arg arrays; `isValidVideoId` returns a boolean and backs
  `assertValidVideoId`/`videoUrl`. (2) Task 2.1 uses one combined invocation and
  derives `kind` from captured stdout/stderr, keeping the temp dir + `finally`
  cleanup, the honored/reported `language`, and three error categories.
- **Bugs addressed:** silent-ignored `language` → `buildTranscriptArgs` passes
  `--sub-langs`, service reports the language actually fetched (Tasks 2.1/2.2);
  no graceful unavailable handling → three distinct error categories incl.
  `TranscriptUnavailableError` (Task 2.1); CWD no-cleanup download pattern →
  per-request temp dir + `finally`, size cap, no `[0]`-on-undefined (Task 3.1).
- **Main Purpose:** yt-dlp is the sole transcript backend (decisions 1+2, Phase 2)
  and the download capability is revived on yt-dlp (decision 4, Phase 3).
- **Hazards mapped:** binary presence → `YtDlpNotInstalledError` + docs (1.1, 4.4);
  ffmpeg presence → mapped error + docs (3.1, 4.4); command injection → `execFile`
  array args + `isValidVideoId`/`assertValidVideoId` at the service layer +
  enum-throwing `buildDownloadArgs` (1.1, 2.1, 3.1); stdout discipline → captured
  buffers, no inherited stdio, output to disk via `-o`+`cwd` (1.1, 2.1, 3.1); temp
  files → `mkdtemp` + `finally` cleanup (2.1, 3.1); concurrency → unique
  per-request dirs (2.1, 3.1); error/timeout → typed errors + `timeout`/kill
  mapping (1.1); data-contract → json3 parse preserves `{text, offset, duration}`
  and `transcript` key (1.2, 2.1); flag evolution → plural flag forms verified
  against `2026.06.09` (1.1 Risks); ambient-decl/dep cleanup → Tasks 4.1/4.2.
- **Locked-surface conformance:**
  - Operator-mandated exports in `src/services/ytdlp.ts`:
    `buildTranscriptArgs({videoId, language}): string[]`,
    `buildDownloadArgs({videoId, format, quality}): string[]`,
    `isValidVideoId(id): boolean`, `parseJson3Transcript(raw): TranscriptLine[]` —
    reproduced exactly (Tasks 1.1, 1.2). PASS.
  - `transcripts_getTranscript` tool name + schema (`videoId` required, `language`
    optional) — unchanged (`src/server.ts:171-187`). PASS.
  - Transcript return contract `{ videoId, language, transcript: [{text, offset,
    duration}] }`, offset/duration in ms, sourced from json3 — preserved; `kind`
    is additive (Tasks 1.3, 2.1). PASS.
  - `summarizeResult` keys `transcript` / `timestampedTranscript` — field names
    preserved (Tasks 2.1, 2.2). PASS.
  - API-key startup gate `index.ts:6-10` / `cli.ts:8-12` — untouched (decision 5).
    PASS.
  - Every step is executable without a further design decision; the Plan-owned
    choices (download return shape, `kind` field name, videoId-validation seam) are
    resolved at the top under Open Questions.
</content>
</invoke>
