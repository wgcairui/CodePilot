import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { minimaxMediaProvider } from '@/lib/providers/minimax-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const row = getDb()
      .prepare('SELECT api_key, base_url, provider_type, extra_env FROM api_providers WHERE id = ?')
      .get(id) as { api_key: string; base_url: string; provider_type: string; extra_env?: string } | undefined;

    if (!row) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    if (row.provider_type !== 'minimax-media' && !row.base_url.includes('minimaxi.com') && !row.base_url.includes('minimax.io')) {
      return NextResponse.json(
        { error: 'Quota is only available for MiniMax providers' },
        { status: 400 },
      );
    }

    let apiKey = row.api_key || '';
    if (!apiKey) {
      try {
        const env = JSON.parse(row.extra_env || '{}') as Record<string, string>;
        apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
      } catch { /* ignore */ }
    }

    const baseUrl = row.base_url;

    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured for this provider' }, { status: 400 });
    }

    const quota = await minimaxMediaProvider.fetchQuota!(apiKey, baseUrl);
    return NextResponse.json(quota);
  } catch (error) {
    console.error(`[providers/${id}/quota] failed:`, error);
    const message = error instanceof Error ? error.message : 'Failed to fetch quota';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
