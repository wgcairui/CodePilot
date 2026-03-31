import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  const filePath = req.nextUrl.searchParams.get('path');
  const staged = req.nextUrl.searchParams.get('staged') === 'true';

  if (!cwd || !filePath) {
    return NextResponse.json({ error: 'cwd and path are required' }, { status: 400 });
  }

  try {
    const diff = await gitService.getFileDiff(cwd, filePath, staged);
    return NextResponse.json({ diff });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get diff' },
      { status: 500 }
    );
  }
}
