/**
 * GET /api/providers/[id]/raw-key
 *
 * Returns the unmasked api_key for the given provider.
 * Used exclusively by the "import key from existing provider" flow in the UI.
 * Safe in Electron context where the user IS the server.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const row = getDb()
    .prepare('SELECT api_key FROM api_providers WHERE id = ?')
    .get(id) as { api_key: string } | undefined;

  if (!row) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  return NextResponse.json({ api_key: row.api_key });
}
