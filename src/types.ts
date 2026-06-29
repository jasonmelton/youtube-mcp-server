/**
 * Video details parameters
 */
export interface VideoParams {
  videoId: string;
  parts?: string[];
}

/**
 * Search videos parameters
 */
export interface SearchParams {
  query: string;
  maxResults?: number;
  order?: string;
  publishedAfter?: string;
  publishedBefore?: string;
  channelId?: string;
  uniqueChannels?: boolean;
  channelMinSubscribers?: number;
  channelMaxSubscribers?: number;
  channelLastUploadAfter?: string;
  channelLastUploadBefore?: string;
  creatorOnly?: boolean;
  sortBy?: 'relevance' | 'date' | 'subscribers_asc' | 'subscribers_desc' | 'indie_priority' | 'recent_activity';
}

/**
 * Trending videos parameters
 */
export interface TrendingParams {
  regionCode?: string;
  maxResults?: number;
  videoCategoryId?: string;
}

/**
 * Related videos parameters
 */
export interface RelatedVideosParams {
  videoId: string;
  maxResults?: number;
}

/**
 * Transcript parameters
 */
export interface TranscriptParams {
  videoId: string;
  language?: string;
}

/**
 * Search transcript parameters
 */
export interface SearchTranscriptParams {
  videoId: string;
  query: string;
  language?: string;
}

/**
 * A single transcript cue. offset/duration are in milliseconds.
 */
export interface TranscriptLine {
  text: string;
  offset: number;   // milliseconds
  duration: number; // milliseconds
}

/**
 * Whether captions were human-authored or auto-generated.
 */
export type TranscriptKind = 'human' | 'auto';

/**
 * Transcript result. Preserves the locked { videoId, language, transcript }
 * contract; `kind` is additive.
 */
export interface TranscriptResult {
  videoId: string;
  language: string;            // language ACTUALLY fetched
  kind: TranscriptKind;        // human captions vs auto-generated
  transcript: TranscriptLine[];
}

/**
 * Media/audio download parameters (yt-dlp backend).
 */
export type DownloadFormat = 'mp4' | 'mp3' | 'wav';
export type DownloadQuality = 'highest' | 'lowest' | '1080p' | '720p' | '480p' | '360p';

export interface DownloadMediaParams {
  videoId: string;
  format?: DownloadFormat;
  quality?: DownloadQuality;
}

/**
 * Channel parameters
 */
export interface ChannelParams {
  channelId: string;
}

/**
 * Channel lookup parameters
 */
export interface ChannelsParams {
  channelIds: string[];
  parts?: string[];
  includeLatestUpload?: boolean;
}

/**
 * Channel search parameters
 */
export interface ChannelSearchParams {
  query: string;
  maxResults?: number;
  order?: string;
  channelType?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  lastUploadAfter?: string;
  lastUploadBefore?: string;
  creatorOnly?: boolean;
  sortBy?: 'relevance' | 'subscribers_asc' | 'subscribers_desc' | 'indie_priority' | 'recent_activity';
}

/**
 * Creator discovery parameters
 */
export interface CreatorDiscoveryParams {
  query: string;
  maxResults?: number;
  order?: string;
  videoPublishedAfter?: string;
  videoPublishedBefore?: string;
  channelMinSubscribers?: number;
  channelMaxSubscribers?: number;
  channelLastUploadAfter?: string;
  channelLastUploadBefore?: string;
  creatorOnly?: boolean;
  sortBy?: 'relevance' | 'subscribers_asc' | 'subscribers_desc' | 'indie_priority' | 'recent_activity';
  sampleVideosPerChannel?: number;
}

/**
 * Channel videos parameters
 */
export interface ChannelVideosParams {
  channelId: string;
  maxResults?: number;
}

/**
 * Playlist parameters
 */
export interface PlaylistParams {
  playlistId: string;
}

/**
 * Playlist items parameters
 */
export interface PlaylistItemsParams {
  playlistId: string;
  maxResults?: number;
}
