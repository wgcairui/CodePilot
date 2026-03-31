import { NextRequest, NextResponse } from 'next/server';
import { checkVideoJob } from '@/lib/video-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    // Advance job status (no-op if already completed/failed)
    const job = await checkVideoJob(id);
    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Video job not found' }, { status: 404 });
    }
    console.error(`[media/video/${id}] check failed:`, error);
    const message = error instanceof Error ? error.message : 'Failed to check video job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
