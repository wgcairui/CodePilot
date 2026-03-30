/**
 * MinimaxMediaProvider — MiniMax image + video generation + quota query.
 *
 * Image API:  POST /v1/image_generation  (synchronous, returns base64)
 * Video API:  POST /v1/video_generation  (async, returns task_id)
 * Quota API:  GET  https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains
 */

import type {
  MediaProvider,
  GenerateImageParams,
  GenerateImageRawResult,
  GenerateVideoParams,
  SubmitVideoResult,
  QuotaInfo,
} from './types';

const DEFAULT_IMAGE_MODEL = 'image-01';
const DEFAULT_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';
const QUOTA_URL = 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains';

export class MinimaxMediaProvider implements MediaProvider {
  readonly name = 'minimax';

  async generateImage(
    params: GenerateImageParams,
    apiKey: string,
    baseUrl: string,
    extraEnv: Record<string, string>,
  ): Promise<GenerateImageRawResult> {
    const startTime = Date.now();
    const model = params.model || extraEnv.MINIMAX_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio || '1:1',
      response_format: 'base64',
    };

    // subject_reference for style/character consistency
    const refImages = params.referenceImages || [];
    if (refImages.length > 0) {
      body.subject_reference = refImages.map(img => ({
        type: 'character',
        image_base64: img.data,
      }));
    }

    const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/image_generation`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`MiniMax image generation failed (${res.status}): ${text}`);
    }

    const json = await res.json() as {
      data?: { image_base64?: string | string[] };
      base_resp?: { status_code: number; status_msg: string };
    };

    if (json.base_resp && json.base_resp.status_code !== 0) {
      throw new Error(`MiniMax image error ${json.base_resp.status_code}: ${json.base_resp.status_msg}`);
    }

    // MiniMax returns image_base64 as an array (even for a single image)
    const raw = json.data?.image_base64;
    const base64List: string[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (base64List.length === 0) throw new Error('MiniMax returned no image data');

    const elapsed = Date.now() - startTime;
    console.log(`[minimax-media] image ${model} completed in ${elapsed}ms`);

    return {
      images: base64List.map(b64 => ({ mimeType: 'image/jpeg', data: Buffer.from(b64, 'base64') })),
      model,
      elapsedMs: elapsed,
    };
  }

  async generateVideo(
    params: GenerateVideoParams,
    apiKey: string,
    baseUrl: string,
    extraEnv: Record<string, string>,
  ): Promise<SubmitVideoResult> {
    const model = params.model || extraEnv.MINIMAX_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    if (params.duration) body.duration = params.duration;
    if (params.resolution) body.resolution = params.resolution;
    if (params.firstFrameImage) body.first_frame_image = params.firstFrameImage;

    const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/video_generation`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.abortSignal || AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`MiniMax video submission failed (${res.status}): ${text}`);
    }

    const json = await res.json() as {
      task_id?: string;
      base_resp?: { status_code: number; status_msg: string };
    };

    if (json.base_resp && json.base_resp.status_code !== 0) {
      throw new Error(`MiniMax video error ${json.base_resp.status_code}: ${json.base_resp.status_msg}`);
    }

    if (!json.task_id) throw new Error('MiniMax returned no task_id');

    console.log(`[minimax-media] video task submitted: ${json.task_id}`);
    return { taskId: json.task_id };
  }

  async fetchQuota(apiKey: string, _baseUrl: string): Promise<QuotaInfo> {
    const res = await fetch(QUOTA_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`MiniMax quota query failed (${res.status}): ${text}`);
    }

    const json = await res.json() as Record<string, unknown>;

    // Response: { model_remains: [{ model_name, current_interval_total_count,
    //   current_interval_usage_count, current_weekly_total_count, current_weekly_usage_count }] }
    const rawModels = Array.isArray(json.model_remains)
      ? (json.model_remains as Record<string, unknown>[])
      : [];

    const models = rawModels.map(m => {
      const iTotal = Number(m.current_interval_total_count ?? 0);
      const iUsed  = Number(m.current_interval_usage_count ?? 0);
      const wTotal = Number(m.current_weekly_total_count ?? 0);
      const wUsed  = Number(m.current_weekly_usage_count ?? 0);
      return {
        modelName: String(m.model_name ?? ''),
        intervalTotal: iTotal,
        intervalRemains: Math.max(0, iTotal - iUsed),
        intervalStartTime: Number(m.start_time) || undefined,
        intervalEndTime: Number(m.end_time) || undefined,
        intervalRemainsMs: Number(m.remains_time) || undefined,
        weeklyTotal: wTotal,
        weeklyRemains: Math.max(0, wTotal - wUsed),
        weeklyStartTime: Number(m.weekly_start_time) || undefined,
        weeklyEndTime: Number(m.weekly_end_time) || undefined,
        weeklyRemainsMs: Number(m.weekly_remains_time) || undefined,
      };
    });

    return { models, raw: json };
  }
}

export const minimaxMediaProvider = new MinimaxMediaProvider();

/** Poll MiniMax for video task status. Returns download URL on success, null if still processing. */
export async function pollMinimaxVideoTask(
  taskId: string,
  apiKey: string,
  baseUrl: string,
): Promise<{ status: 'Success' | 'Fail' | 'Processing'; fileId?: string; error?: string }> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MiniMax video poll failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    status?: string;
    file_id?: string;
    base_resp?: { status_code: number; status_msg: string };
  };

  if (json.base_resp && json.base_resp.status_code !== 0) {
    return { status: 'Fail', error: json.base_resp.status_msg };
  }

  const status = json.status === 'Success' ? 'Success'
    : json.status === 'Fail' ? 'Fail'
    : 'Processing';

  return { status, fileId: json.file_id };
}

/** Retrieve a video file download URL from MiniMax file ID. */
export async function retrieveMinimaxVideoFile(
  fileId: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MiniMax file retrieve failed (${res.status}): ${text}`);
  }

  const json = await res.json() as { file?: { download_url?: string } };
  const url = json.file?.download_url;
  if (!url) throw new Error('MiniMax returned no download_url');
  return url;
}
