/**
 * media-generator.ts — unified media generation entry point.
 *
 * Replaces image-generator.ts. Selects the correct MediaProvider based on
 * the active provider's protocol, then delegates API calls to the provider.
 * File persistence, project-copy, and DB writes stay here as shared infrastructure.
 *
 * Backward-compat: generateSingleImage() signature is unchanged so image-gen-mcp.ts
 * needs no modification.
 */

import { getDb, getSession } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { GenerateImageParams } from './providers/types';
import { geminiImageProvider } from './providers/gemini-image';
import { minimaxMediaProvider } from './providers/minimax-media';

export { NoImageGeneratedError } from './providers/gemini-image';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
export const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

// ── Provider resolution ─────────────────────────────────────────

interface ProviderRow {
  id: string;
  api_key: string;
  base_url: string;
  extra_env?: string;
  provider_type: string;
}

function getMediaProvider(providerType: string) {
  if (providerType === 'minimax-media') return minimaxMediaProvider;
  return geminiImageProvider; // default (gemini-image)
}

function findActiveImageProvider(providerId?: string | null): ProviderRow {
  const db = getDb();

  if (providerId) {
    const specific = db.prepare(
      `SELECT id, api_key, base_url, extra_env, provider_type
       FROM api_providers
       WHERE id = ? AND provider_type IN ('gemini-image', 'minimax-media')`,
    ).get(providerId) as ProviderRow | undefined;
    if (specific) return specific;
  }

  // Auto-select: prefer minimax-media, fall back to gemini-image
  const row = db.prepare(
    `SELECT id, api_key, base_url, extra_env, provider_type
     FROM api_providers
     WHERE provider_type IN ('gemini-image', 'minimax-media') AND api_key != ''
     ORDER BY CASE provider_type WHEN 'minimax-media' THEN 0 ELSE 1 END, sort_order
     LIMIT 1`,
  ).get() as ProviderRow | undefined;

  if (!row) {
    throw new Error(
      'No image provider configured. Please add a Gemini Image or MiniMax Media provider in Settings.',
    );
  }
  return row;
}

// ── Shared persistence helpers ──────────────────────────────────

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function saveBufferToDisk(data: Buffer, mimeType: string): string {
  ensureMediaDir();
  const ext = mimeType === 'image/jpeg' ? '.jpg'
    : mimeType === 'image/webp' ? '.webp'
    : '.png';
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const filePath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(filePath, data);
  return filePath;
}

function copyToProjectDir(localPaths: string[], sessionId: string) {
  try {
    const session = getSession(sessionId);
    if (!session?.working_directory) return;
    const projectImgDir = path.join(session.working_directory, '.codepilot-images');
    if (!fs.existsSync(projectImgDir)) fs.mkdirSync(projectImgDir, { recursive: true });
    for (const p of localPaths) {
      fs.copyFileSync(p, path.join(projectImgDir, path.basename(p)));
    }
    console.log(`[media-generator] Copied ${localPaths.length} file(s) to ${projectImgDir}`);
  } catch (err) {
    console.warn('[media-generator] Failed to copy to project directory:', err);
  }
}

// ── Public API ──────────────────────────────────────────────────

export interface GenerateSingleImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
  abortSignal?: AbortSignal;
  /** When true, skip disk write / project copy / DB insert — MCP pipeline handles persistence */
  skipSave?: boolean;
  cwd?: string;
  /** Explicit provider ID; falls back to auto-selection if omitted or not found */
  providerId?: string | null;
}

export interface GenerateSingleImageResult {
  mediaGenerationId: string;
  images: Array<{ mimeType: string; localPath: string; rawData?: Buffer }>;
  elapsedMs: number;
}

/**
 * Generate a single image. Drop-in replacement for the old image-generator.ts.
 * Automatically selects the active media provider (MiniMax preferred, Gemini fallback).
 */
export async function generateSingleImage(
  params: GenerateSingleImageParams,
): Promise<GenerateSingleImageResult> {
  const providerRow = findActiveImageProvider(params.providerId);
  const provider = getMediaProvider(providerRow.provider_type);

  let extraEnv: Record<string, string> = {};
  try { extraEnv = JSON.parse(providerRow.extra_env || '{}'); } catch { /* use default */ }

  const genParams: GenerateImageParams = {
    prompt: params.prompt,
    model: params.model,
    aspectRatio: params.aspectRatio,
    imageSize: params.imageSize,
    referenceImages: params.referenceImages,
    referenceImagePaths: params.referenceImagePaths,
    abortSignal: params.abortSignal,
    cwd: params.cwd,
  };

  const raw = await provider.generateImage(
    genParams,
    providerRow.api_key,
    providerRow.base_url,
    extraEnv,
  );

  // skipSave: return raw buffers without touching disk or DB
  if (params.skipSave) {
    return {
      mediaGenerationId: '',
      images: raw.images.map(img => ({
        mimeType: img.mimeType,
        localPath: '',
        rawData: img.data,
      })),
      elapsedMs: raw.elapsedMs,
    };
  }

  // Save to disk
  const savedImages = raw.images.map(img => ({
    mimeType: img.mimeType,
    localPath: saveBufferToDisk(img.data, img.mimeType),
  }));

  // Copy to project directory
  if (params.sessionId) {
    copyToProjectDir(savedImages.map(i => i.localPath), params.sessionId);
  }

  // Save reference images to disk for gallery display
  const savedRefImages: Array<{ mimeType: string; localPath: string }> = [];
  const refImages = params.referenceImages || [];
  for (const ref of refImages) {
    savedRefImages.push({
      mimeType: ref.mimeType,
      localPath: saveBufferToDisk(Buffer.from(ref.data, 'base64'), ref.mimeType),
    });
  }

  // DB record
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const metadata: Record<string, unknown> = {
    imageCount: savedImages.length,
    elapsedMs: raw.elapsedMs,
    model: raw.model,
  };
  if (savedRefImages.length > 0) metadata.referenceImages = savedRefImages;

  getDb().prepare(
    `INSERT INTO media_generations
       (id, type, status, provider, model, prompt, aspect_ratio, image_size,
        local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, 'image', 'completed',
    provider.name, raw.model,
    params.prompt,
    params.aspectRatio || '1:1',
    params.imageSize || '1K',
    savedImages[0]?.localPath || '',
    '',
    params.sessionId || null,
    null,
    '[]',
    JSON.stringify(metadata),
    null,
    now, now,
  );

  return {
    mediaGenerationId: id,
    images: savedImages,
    elapsedMs: raw.elapsedMs,
  };
}
