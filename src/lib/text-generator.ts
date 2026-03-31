import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { resolveProvider as resolveProviderUnified, toAiSdkConfig } from './provider-resolver';
import type { AiSdkConfig } from './provider-resolver';

export interface StreamTextParams {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

/**
 * Build the AI SDK model instance from a resolved AiSdkConfig.
 * Shared between streaming and non-streaming paths.
 */
function buildSdkModel(config: AiSdkConfig) {
  const hasHeaders = config.headers && Object.keys(config.headers).length > 0;

  switch (config.sdkType) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        ...(config.authToken
          ? { authToken: config.authToken }
          : { apiKey: config.apiKey }),
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return anthropic(config.modelId);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return openai(config.modelId);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return google(config.modelId);
    }
    case 'bedrock': {
      const bedrock = createAmazonBedrock({
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return bedrock(config.modelId);
    }
    case 'vertex': {
      const vertex = createVertexAnthropic({
        ...(hasHeaders ? { headers: config.headers } : {}),
      });
      return vertex(config.modelId);
    }
  }
}

/**
 * Resolve provider config and inject process env if needed (bedrock/vertex).
 * Returns { resolved, config, model }.
 */
function resolveAndBuild(params: StreamTextParams) {
  const resolved = resolveProviderUnified({ providerId: params.providerId });

  if (!resolved.hasCredentials && !resolved.provider) {
    throw new Error('No text generation provider available. Please configure a provider in Settings.');
  }

  const config = toAiSdkConfig(resolved, params.model);

  // Inject process env if needed (bedrock/vertex)
  for (const [k, v] of Object.entries(config.processEnvInjections)) {
    process.env[k] = v;
  }

  const model = buildSdkModel(config);
  return { resolved, config, model };
}

/**
 * Stream text from the user's current provider.
 * Returns an async iterable of text chunks.
 *
 * Provider resolution is fully delegated to the unified resolver.
 * No fallback logic here — the resolver's chain (explicit → session → global default → env)
 * is the single source of truth, matching the Claude Code SDK path.
 *
 * NOTE: Do NOT expand model aliases (sonnet/opus/haiku) here.
 * toAiSdkConfig() resolves model IDs through the provider's availableModels catalog,
 * which uses the short alias as modelId. Expanding aliases would break that lookup
 * for SDK proxy providers (Kimi, GLM, MiniMax, etc.) that expect short aliases.
 */
export async function* streamTextFromProvider(params: StreamTextParams): AsyncIterable<string> {
  const { model } = resolveAndBuild(params);

  const result = streamText({
    model: model!,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Uses streamText + result.text so streaming-only providers (e.g. MiniMax, Kimi)
 * work correctly — they return empty from non-streaming requests.
 * result.text internally consumes the stream and properly surfaces errors.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  const { model } = resolveAndBuild(params);

  const result = streamText({
    model: model!,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  return await result.text;
}
