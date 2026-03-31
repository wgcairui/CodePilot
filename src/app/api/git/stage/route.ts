import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, path } = await req.json();
    if (!cwd || !path) {
      return NextResponse.json({ error: 'cwd and path are required' }, { status: 400 });
    }
    await gitService.stageFile(cwd, path);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stage failed' },
      { status: 500 },
    );
  }
}
