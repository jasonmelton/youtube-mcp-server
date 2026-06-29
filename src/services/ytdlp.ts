import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TranscriptLine, DownloadFormat, DownloadQuality } from '../types.js';

const execFileAsync = promisify(execFile);
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Thrown when the yt-dlp binary cannot be found (ENOENT). */
export class YtDlpNotInstalledError extends Error {
  constructor(bin: string) {
    super(`yt-dlp executable not found ("${bin}"). Install yt-dlp and ensure it is on PATH (or set YTDLP_PATH). See README prerequisites.`);
    this.name = 'YtDlpNotInstalledError';
  }
}

/** Thrown when yt-dlp runs but fails (non-zero exit, timeout/kill). */
export class YtDlpFailedError extends Error {
  constructor(message: string, public readonly exitCode: number | null, public readonly stderr: string) {
    super(message);
    this.name = 'YtDlpFailedError';
  }
}

/** Boolean predicate: true only for a canonical 11-char YouTube video id. */
export function isValidVideoId(id: unknown): boolean {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

/** Throwing guard built on isValidVideoId. */
export function assertValidVideoId(videoId: string): void {
  if (!isValidVideoId(videoId)) {
    throw new Error('Invalid videoId: expected 11 characters of [A-Za-z0-9_-].');
  }
}

/** Build the canonical watch URL after validating the id. */
export function videoUrl(videoId: string): string {
  assertValidVideoId(videoId);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Pure builder for the transcript-fetch arg array. Requests both human and
 * auto subs in one invocation, json3 format, skips the media download, and
 * emits `videoId` as a discrete trailing element. The relative `-o` template
 * lets the runner's `cwd` decide where files land while keeping this pure.
 */
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

/**
 * Pure builder for the media/audio download arg array. Throws on a
 * format/quality outside the allowed enums (defense in depth on top of the
 * execFile array boundary). Audio formats opt into ffmpeg extraction.
 */
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

/**
 * Run yt-dlp with an argument array (never a shell string). Captures
 * stdout/stderr into buffers — does NOT inherit the process stdio, so yt-dlp
 * output never reaches the MCP stdio channel. Maps failures to typed errors.
 */
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

interface Json3Seg { utf8?: string; }
interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[]; }

/**
 * Pure parser: yt-dlp json3 subtitles -> TranscriptLine[]. Maps
 * events[].tStartMs -> offset, dDurationMs -> duration, joined segs[].utf8 ->
 * text. Skips empty/timing-only events. Preserves per-cue millisecond timing.
 */
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
