import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runYtDlp, buildDownloadArgs, assertValidVideoId, YtDlpFailedError } from './ytdlp.js';
import { DownloadMediaParams, DownloadFormat } from '../types.js';

const AUDIO = new Set<DownloadFormat>(['mp3', 'wav']);
const MAX_BYTES = Number(process.env.YTDLP_MAX_DOWNLOAD_BYTES || 50 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.YTDLP_DOWNLOAD_TIMEOUT_MS || 300_000);

/**
 * Downloads YouTube video/audio via yt-dlp. Each request writes into a unique
 * temp dir that is removed in `finally`; the bytes are returned inline as
 * base64 since no artifact survives the cleanup.
 */
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
