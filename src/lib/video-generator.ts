/**
 * video-generator.ts — async video generation lifecycle.
 *
 * Flow:
 *   1. submitVideoJob()   → calls provider.generateVideo() → inserts video_jobs row
 *   2. checkVideoJob()    → polls platform status → downloads file on success → updates DB
 *   3. Gallery polls /api/media/video/[id] which calls checkVideoJob()
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '@/lib/db';
import { minimaxMediaProvider, pollMinimaxVideoTask, retrieveMinimaxVideoFile } from './providers/minimax-media';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

export type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface VideoJob {
  id: string;
  task_id: string;
  provider_id: string;
  session_id: string | null;
  prompt: string;
  model: string;
  status: VideoJobStatus;
  local_path: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SubmitVideoJobParams {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  firstFrameImage?: string;
  sessionId?: string;
}

interface ProviderRow {
  id: string;
  api_key: string;
  base_url: string;
  extra_env?: string;
  provider_type: string;
}

function findVideoProvider(): ProviderRow {
  const row = getDb().prepare(
    `SELECT id, api_key, base_url, extra_env, provider_type
     FROM api_providers
     WHERE provider_type = 'minimax-media' AND api_key != ''
     ORDER BY sort_order LIMIT 1`,
  ).get() as ProviderRow | undefined;

  if (!row) {
    throw new Error(
      'No MiniMax Media provider configured. Please add a MiniMax Media provider in Settings → Providers.',
    );
  }
  return row;
}

/**
 * Submit a video generation job. Returns the local video_jobs record ID.
 */
export async function submitVideoJob(params: SubmitVideoJobParams): Promise<string> {
  const providerRow = findVideoProvider();
  let extraEnv: Record<string, string> = {};
  try { extraEnv = JSON.parse(providerRow.extra_env || '{}'); } catch { /* use default */ }

  const model = params.model || extraEnv.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3';

  const { taskId } = await minimaxMediaProvider.generateVideo!(
    {
      prompt: params.prompt,
      model,
      duration: params.duration,
      resolution: params.resolution,
      firstFrameImage: params.firstFrameImage,
    },
    providerRow.api_key,
    providerRow.base_url,
    extraEnv,
  );

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  getDb().prepare(
    `INSERT INTO video_jobs (id, task_id, provider_id, session_id, prompt, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, taskId, providerRow.id, params.sessionId || null, params.prompt, model, now);

  console.log(`[video-generator] Job ${id} submitted, task_id=${taskId}`);
  return id;
}

/**
 * Check and advance a video job's status.
 * - pending/processing → poll platform; download on success
 * - completed/failed   → no-op
 * Returns the updated job.
 */
export async function checkVideoJob(jobId: string): Promise<VideoJob> {
  const db = getDb();
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId) as VideoJob | undefined;
  if (!job) throw new Error(`Video job ${jobId} not found`);

  if (job.status === 'completed' || job.status === 'failed') return job;

  // Look up provider credentials
  const providerRow = db.prepare(
    'SELECT api_key, base_url FROM api_providers WHERE id = ?',
  ).get(job.provider_id) as Pick<ProviderRow, 'api_key' | 'base_url'> | undefined;

  if (!providerRow) {
    db.prepare("UPDATE video_jobs SET status = 'failed', error = ? WHERE id = ?")
      .run('Provider no longer exists', jobId);
    return { ...job, status: 'failed', error: 'Provider no longer exists' };
  }

  const pollResult = await pollMinimaxVideoTask(job.task_id, providerRow.api_key, providerRow.base_url);

  if (pollResult.status === 'Processing') {
    // Mark as processing if still pending
    if (job.status === 'pending') {
      db.prepare("UPDATE video_jobs SET status = 'processing' WHERE id = ?").run(jobId);
    }
    return { ...job, status: 'processing' };
  }

  if (pollResult.status === 'Fail') {
    db.prepare("UPDATE video_jobs SET status = 'failed', error = ? WHERE id = ?")
      .run(pollResult.error || 'MiniMax reported failure', jobId);
    return { ...job, status: 'failed', error: pollResult.error || 'MiniMax reported failure' };
  }

  // Success — download the video file
  if (!pollResult.fileId) {
    db.prepare("UPDATE video_jobs SET status = 'failed', error = ? WHERE id = ?")
      .run('No file_id in success response', jobId);
    return { ...job, status: 'failed', error: 'No file_id in success response' };
  }

  const downloadUrl = await retrieveMinimaxVideoFile(
    pollResult.fileId, providerRow.api_key, providerRow.base_url,
  );

  // Download video to disk
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const filename = `video-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;
  const localPath = path.join(MEDIA_DIR, filename);

  const videoRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(300_000) });
  if (!videoRes.ok) throw new Error(`Video download failed: ${videoRes.status}`);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(localPath, buf);

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    "UPDATE video_jobs SET status = 'completed', local_path = ?, completed_at = ? WHERE id = ?",
  ).run(localPath, now, jobId);

  console.log(`[video-generator] Job ${jobId} completed → ${localPath}`);
  return { ...job, status: 'completed', local_path: localPath, completed_at: now };
}

/** Get a single video job by ID. */
export function getVideoJob(jobId: string): VideoJob | null {
  return (getDb().prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId) as VideoJob | undefined) ?? null;
}

/** List all video jobs, newest first. */
export function listVideoJobs(limit = 50): VideoJob[] {
  return getDb().prepare(
    'SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?',
  ).all(limit) as VideoJob[];
}
