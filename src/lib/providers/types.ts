/**
 * MediaProvider interface — strategy contract for all media generation backends.
 *
 * Each provider implements at minimum generateImage(). generateVideo() and
 * fetchQuota() are optional capabilities — callers check before invoking.
 */

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  /** Base64-encoded reference images */
  referenceImages?: { mimeType: string; data: string }[];
  /** File paths to reference images (resolved at call site) */
  referenceImagePaths?: string[];
  abortSignal?: AbortSignal;
  /** Working directory for resolving relative referenceImagePaths */
  cwd?: string;
}

export interface GenerateImageRawResult {
  images: Array<{ mimeType: string; data: Buffer }>;
  model: string;
  elapsedMs: number;
}

export interface GenerateVideoParams {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  /** First frame image as base64 */
  firstFrameImage?: string;
  abortSignal?: AbortSignal;
}

export interface SubmitVideoResult {
  /** Platform task ID for polling */
  taskId: string;
}

export interface QuotaModelEntry {
  modelName: string;
  weeklyRemains: number;
  weeklyTotal: number;
  weeklyStartTime?: number;  // ms timestamp
  weeklyEndTime?: number;    // ms timestamp
  weeklyRemainsMs?: number;  // ms until weekly reset
  intervalRemains: number;
  intervalTotal: number;
  intervalStartTime?: number; // ms timestamp
  intervalEndTime?: number;   // ms timestamp
  intervalRemainsMs?: number; // ms until interval reset
}

export interface QuotaInfo {
  /** Per-model quota breakdown */
  models: QuotaModelEntry[];
  raw?: Record<string, unknown>;
}

export interface MediaProvider {
  /** Human-readable provider name for logging */
  readonly name: string;

  /** Generate image(s) from prompt. Returns raw buffer data — caller handles persistence. */
  generateImage(
    params: GenerateImageParams,
    apiKey: string,
    baseUrl: string,
    extraEnv: Record<string, string>,
  ): Promise<GenerateImageRawResult>;

  /** Submit async video generation task. Returns task ID for polling. */
  generateVideo?(
    params: GenerateVideoParams,
    apiKey: string,
    baseUrl: string,
    extraEnv: Record<string, string>,
  ): Promise<SubmitVideoResult>;

  /** Query remaining quota. */
  fetchQuota?(
    apiKey: string,
    baseUrl: string,
  ): Promise<QuotaInfo>;
}
