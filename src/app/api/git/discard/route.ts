import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, path, untracked } = await req.json();
    if (!cwd || !path) {
      return NextResponse.json({ error: 'cwd and path are required' }, { status: 400 });
    }
    await gitService.discardFile(cwd, path, !!untracked);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discard failed' },
      { status: 500 },
    );
  }
}
