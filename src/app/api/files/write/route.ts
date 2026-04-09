import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isPathSafe, isRootPath } from '@/lib/files';
import type { ErrorResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  let body: { path?: string; content?: string; baseDir?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path: filePath, content, baseDir } = body;

  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json<ErrorResponse>({ error: 'Missing or invalid path' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json<ErrorResponse>({ error: 'Missing or invalid content' }, { status: 400 });
  }
  if (!baseDir || typeof baseDir !== 'string') {
    return NextResponse.json<ErrorResponse>(
      { error: 'baseDir is required for write operations' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Content exceeds 10 MB limit' },
      { status: 413 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory' },
      { status: 403 }
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'File is outside the project scope' },
      { status: 403 }
    );
  }

  try {
    await fs.writeFile(resolvedPath, content, 'utf8');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to write file' },
      { status: 500 }
    );
  }
}
