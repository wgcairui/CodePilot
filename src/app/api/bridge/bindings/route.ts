import { NextResponse } from 'next/server';
import { listChannelBindings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bridge/bindings — Return active channel bindings for UI channel selectors.
 */
export async function GET() {
  try {
    const bindings = listChannelBindings()
      .filter(b => b.active)
      .map(b => ({ channelType: b.channelType, chatId: b.chatId }));
    return NextResponse.json({ bindings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bindings' },
      { status: 500 }
    );
  }
}
