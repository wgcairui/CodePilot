import { NextRequest, NextResponse } from 'next/server';
import { testProviderConnection } from '@/lib/claude-client';
import { getPreset } from '@/lib/provider-catalog';
import type { ErrorResponse } from '@/types';

/**
 * POST /api/providers/test
 *
 * Test a provider connection without saving to DB.
 * Sends a minimal SDK query and returns structured success/error.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { presetKey, apiKey, baseUrl, protocol, authStyle, envOverrides, providerName, modelName } = body;

    if (!apiKey && authStyle !== 'env_only') {
      return NextResponse.json({ success: false, error: { code: 'NO_CREDENTIALS', message: 'API Key is required', suggestion: 'Please enter your API key' } });
    }

    // Look up preset meta for recovery action URLs
    const preset = presetKey ? getPreset(presetKey) : undefined;
    const meta = preset?.meta;

    const result = await testProviderConnection({
      apiKey: apiKey || '',
      baseUrl: baseUrl || '',
      protocol: protocol || 'anthropic',
      authStyle: authStyle || 'api_key',
      envOverrides: envOverrides || {},
      modelName: modelName || undefined,
      presetKey: presetKey || undefined,
      providerName: providerName || preset?.name || 'Unknown',
      providerMeta: meta ? { apiKeyUrl: meta.apiKeyUrl, docsUrl: meta.docsUrl, pricingUrl: meta.pricingUrl } : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to test connection', details: String(err) } as ErrorResponse,
      { status: 500 },
    );
  }
}
