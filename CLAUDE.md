# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YouTube MCP Server is a Model Context Protocol (MCP) server implementation that enables AI language models to interact with YouTube content. It provides tools for accessing video information, transcripts, channel data, and playlist management through standardized MCP interfaces.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Start the server
npm start

# Development mode with auto-rebuild and hot reload
npm run dev

# Publish to npm (runs build first)
npm run prepublishOnly
```

## Architecture

### Core Structure

The project uses a **service-based architecture** with the following layers:

1. **Entry Point** (`src/index.ts`): Validates required environment variables and starts the MCP server
2. **Server** (`src/server.ts`): Sets up the MCP server, defines available tools, and routes tool calls to appropriate services
3. **Services** (`src/services/`): Core business logic for interacting with YouTube APIs
   - `VideoService`: Handles video operations (get video details, search videos)
   - `TranscriptService`: Retrieves and manages video transcripts
   - `PlaylistService`: Manages playlist operations
   - `ChannelService`: Handles channel-related operations
4. **Types** (`src/types.ts`): TypeScript interfaces for function parameters and data structures
5. **Functions** (`src/functions/`): Additional functionality (currently excluded from compilation but available for future extensions)

### MCP Tool Registration

Tools are registered in `src/server.ts` through the `ListToolsRequestSchema` handler (lines 39-165). Each tool has:
- A name following the pattern `{service}_{operation}` (e.g., `videos_getVideo`)
- A description for the AI model
- An input schema defining expected parameters

Tool execution is handled in `CallToolRequestSchema` handler (lines 167-254) with a switch statement routing to the appropriate service method.

### API Integration

Services use the **Google APIs Node.js client library** (`googleapis` package) with lazy initialization:
- The YouTube API client is initialized only when needed (not in constructor)
- API key is read from `YOUTUBE_API_KEY` environment variable at initialization time
- Each service maintains its own `youtube` client instance

### Module System

The project uses **ES modules** (ESNext) as configured in:
- `package.json`: `"type": "module"`
- `tsconfig.json`: `"module": "ESNext"`, `"moduleResolution": "bundler"`
- All imports use `.js` extensions (e.g., `import { VideoService } from './services/video.js'`)

## Key Files and Responsibilities

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, validates YOUTUBE_API_KEY |
| `src/server.ts` | MCP server setup and tool routing |
| `src/services/video.ts` | Video lookup and search functionality |
| `src/services/transcript.ts` | Video transcript retrieval (yt-dlp backend) |
| `src/services/ytdlp.ts` | yt-dlp seam: subprocess runner, typed errors, videoId validation, arg builders, json3 parser |
| `src/services/download.ts` | Media/audio download via yt-dlp |
| `src/services/playlist.ts` | Playlist operations |
| `src/services/channel.ts` | Channel information and video listing |
| `src/types.ts` | TypeScript type definitions for all parameters |

## Host Prerequisites

- `yt-dlp` must be on `PATH` (or set `YTDLP_PATH`) — it is the backend for
  `transcripts_getTranscript` and `downloads_downloadMedia`. A missing binary
  surfaces a clear `YtDlpNotInstalledError`.
- `ffmpeg` must be on `PATH` for audio downloads (`mp3`/`wav`) and merged-format
  video.

## Configuration

**Required Environment Variable:**
- `YOUTUBE_API_KEY`: Your YouTube Data API v3 key (must be set before starting the server)

**Optional Environment Variables:**
- `YOUTUBE_TRANSCRIPT_LANG`: Default language for transcripts (defaults to 'en')
- `YTDLP_PATH`: Path to the `yt-dlp` binary (defaults to `yt-dlp` on `PATH`)
- `YTDLP_MAX_DOWNLOAD_BYTES`: Max size for `downloads_downloadMedia` (defaults to 50 MB)
- `YTDLP_DOWNLOAD_TIMEOUT_MS`: Timeout for a media download (defaults to 300000)

## Available Tools

The MCP server exposes these tools to clients:

- `videos_getVideo`: Get detailed video information
- `videos_searchVideos`: Search for videos
- `transcripts_getTranscript`: Retrieve video transcript (via yt-dlp; reports the actual `language` and a `human`/`auto` `kind`)
- `downloads_downloadMedia`: Download a video or extract audio via yt-dlp (returns base64-encoded media)
- `channels_getChannel`: Get channel information
- `channels_listVideos`: List videos from a channel
- `playlists_getPlaylist`: Get playlist details
- `playlists_getPlaylistItems`: List items in a playlist

## Build and Distribution

The project is published as an npm package (`zubeid-youtube-mcp-server`) and can be installed globally or used via npx. The build process:
1. TypeScript compiles to JavaScript in `dist/` directory
2. Binary entry point is set via `bin` field in package.json
3. The `main` field points to `dist/index.js`

## Testing and Validation

The project was recently migrated to ES modules to fix compatibility issues with LibreChat and improve module resolution. When making changes:
- Ensure all imports use `.js` extensions for relative imports
- Verify TypeScript compiles without errors: `npm run build`
- Test the server can start: `npm start` (requires valid YOUTUBE_API_KEY)

## Important Notes

- Lazy initialization of YouTube client prevents API key validation errors until tools are actually called
- The services handle errors gracefully and return error messages to the MCP client
- Response content is JSON-stringified for transmission to the client
- Tests run on Vitest (`npm test`). Pure yt-dlp helpers (arg builders, `videoId`
  validation, json3 parsing) are unit-tested in `src/services/*.test.ts`; the
  production `tsc` build excludes `*.test.ts`
- Transcripts and downloads shell out to `yt-dlp` via `execFile` with array args
  (never a shell string), capturing stdout/stderr so yt-dlp output never corrupts
  the MCP stdio channel; each request uses a temp dir cleaned up in `finally`
