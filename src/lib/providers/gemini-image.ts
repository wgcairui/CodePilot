/**
 * GeminiImageProvider — wraps Google Gemini image generation via Vercel AI SDK.
 *
 * Extracted from the original image-generator.ts. The only change is that
 * the return type is raw buffer data; persistence is handled by media-generator.ts.
 */

import { generateImage, NoImageGeneratedError } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import fs from 'fs';
import path from 'path';
import type { MediaProvider, GenerateImageParams, GenerateImageRawResult } from './types';

export { NoImageGeneratedError };

const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';

export class GeminiImageProvider implements MediaProvider {
  readonly name = 'gemini';

  async generateImage(
    params: GenerateImageParams,
    apiKey: string,
    _baseUrl: string,
    extraEnv: Record<string, string>,
  ): Promise<GenerateImageRawResult> {
    const startTime = Date.now();

    const configuredModel = extraEnv.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
    const requestedModel = params.model || configuredModel;
    const aspectRatio = (params.aspectRatio || '1:1') as `${number}:${number}`;
    const imageSize = params.imageSize || '1K';

    const google = createGoogleGenerativeAI({ apiKey });

    // Resolve reference images from paths + inline base64
    const refImageData: string[] = [];
    if (params.referenceImagePaths && params.referenceImagePaths.length > 0) {
      for (const fp of params.referenceImagePaths) {
        const resolved = path.isAbsolute(fp)
          ? fp
          : path.resolve(params.cwd || process.cwd(), fp);
        if (fs.existsSync(resolved)) {
          refImageData.push(fs.readFileSync(resolved).toString('base64'));
        }
      }
    }
    if (params.referenceImages && params.referenceImages.length > 0) {
      refImageData.push(...params.referenceImages.map(img => img.data));
    }

    const prompt = refImageData.length > 0
      ? { text: params.prompt, images: refImageData }
      : params.prompt;

    const { images } = await generateImage({
      model: google.image(requestedModel),
      prompt,
      providerOptions: {
        google: { imageConfig: { aspectRatio, imageSize } },
      },
      maxRetries: 3,
      abortSignal: params.abortSignal || AbortSignal.timeout(300_000),
    });

    const elapsed = Date.now() - startTime;
    console.log(`[gemini-image] ${requestedModel} ${imageSize} completed in ${elapsed}ms`);

    return {
      images: images.map(img => ({
        mimeType: img.mediaType,
        data: Buffer.from(img.uint8Array),
      })),
      model: requestedModel,
      elapsedMs: elapsed,
    };
  }
}

export const geminiImageProvider = new GeminiImageProvider();
