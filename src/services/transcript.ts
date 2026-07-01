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

/** Thrown when a video has no usable captions in the requested language. */
export class TranscriptUnavailableError extends Error {
  constructor(videoId: string, language: string) {
    super(`No transcript available for video "${videoId}" in language "${language}".`);
    this.name = 'TranscriptUnavailableError';
  }
}

/**
 * Service for interacting with YouTube video transcripts via yt-dlp.
 */
export class TranscriptService {
  /**
   * Fetch and parse a transcript through yt-dlp. Per request: validate the id,
   * create a unique temp dir, run a single combined (human + auto) json3
   * invocation, parse the produced file, derive human-vs-auto from captured
   * output, report the language actually fetched, and clean up in `finally`.
   */
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
      // "Writing video subtitles" => human (preferred when both appear, since
      // human is requested first); only "Writing video auto subtitles" => auto.
      const kind: TranscriptKind = /Writing video subtitles/.test(out) ? 'human' : 'auto';
      return { lines, kind, language: fetched };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Get the transcript of a YouTube video.
   */
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

  /**
   * Search within a transcript.
   */
  async searchTranscript({
    videoId,
    query,
    language = process.env.YOUTUBE_TRANSCRIPT_LANG || 'en',
  }: SearchTranscriptParams): Promise<any> {
    try {
      const { lines, kind, language: fetched } = await this.fetchTranscript(videoId, language);
      const matches = lines.filter((item) =>
        item.text.toLowerCase().includes(query.toLowerCase())
      );
      return { videoId, query, language: fetched, kind, matches, totalMatches: matches.length };
    } catch (error) {
      if (error instanceof YtDlpNotInstalledError || error instanceof TranscriptUnavailableError) throw error;
      throw new Error(`Failed to search transcript: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get transcript with human-readable timestamps.
   */
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
}
