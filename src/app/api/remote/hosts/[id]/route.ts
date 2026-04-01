import { NextResponse } from 'next/server';
import { getRemoteHost, updateRemoteHost, deleteRemoteHost, type RemoteHostRow } from '@/lib/db';

function toApi(row: Omit<RemoteHostRow, 'password'>) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    keyPath: row.key_path ?? undefined,
    workDir: row.work_dir,
    agentPort: row.agent_port,
    status: row.status,
    lastSeen: row.last_seen ?? undefined,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const host = getRemoteHost(id);
  if (!host) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { password: _p, ...safe } = host;
  return NextResponse.json(toApi(safe));
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  // Map camelCase frontend keys to snake_case DB columns
  const updates: Parameters<typeof updateRemoteHost>[1] = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.host !== undefined) updates.host = body.host;
  if (body.port !== undefined) updates.port = body.port;
  if (body.username !== undefined) updates.username = body.username;
  if (body.authType !== undefined) updates.auth_type = body.authType;
  if (body.keyPath !== undefined) updates.key_path = body.keyPath;
  if (body.password !== undefined) updates.password = body.password;
  if (body.workDir !== undefined) updates.work_dir = body.workDir;
  if (body.agentPort !== undefined) updates.agent_port = body.agentPort;
  updateRemoteHost(id, updates);
  const updated = getRemoteHost(id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { password: _p, ...safe } = updated;
  return NextResponse.json(toApi(safe));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteRemoteHost(id);
  return NextResponse.json({ ok: true });
}
