import { NextResponse } from 'next/server';
import { getRemoteHost } from '@/lib/db';

/**
 * Internal-only endpoint consumed by the Electron main process.
 * Returns the full host config including plain-text password so that
 * main.ts can build a RemoteHostConfig without importing better-sqlite3
 * (which has an incompatible ABI in the Electron main process).
 *
 * Only responds to requests from 127.0.0.1 / localhost.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const reqHost = req.headers.get('host') ?? '';
  if (!reqHost.startsWith('127.0.0.1') && !reqHost.startsWith('localhost')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = getRemoteHost(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    keyPath: row.key_path ?? undefined,
    password: row.password ?? undefined,
    agentPort: row.agent_port,
  });
}
