import { NextRequest, NextResponse } from 'next/server';
import { submitVideoJob } from '@/lib/video-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SubmitVideoRequest {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  firstFrameImage?: string;
  sessionId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SubmitVideoRequest = await request.json();

    if (!body.prompt) {
      return NextResponse.json(
        { error: 'Missing required field: prompt' },
        { status: 400 },
      );
    }

    const jobId = await submitVideoJob({
      prompt: body.prompt,
      model: body.model,
      duration: body.duration,
      resolution: body.resolution,
      firstFrameImage: body.firstFrameImage,
      sessionId: body.sessionId,
    });

    return NextResponse.json({ id: jobId, status: 'pending' }, { status: 202 });
  } catch (error) {
    console.error('[media/video] submit failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to submit video job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
