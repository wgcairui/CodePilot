import { NextResponse } from 'next/server';
import { listRemoteHosts, createRemoteHost, type RemoteHostRow } from '@/lib/db';

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

export async function GET() {
  const hosts = listRemoteHosts().map(({ password: _p, ...h }) => toApi(h));
  return NextResponse.json(hosts);
}

export async function POST(req: Request) {
  const { name, host, port, username, authType, keyPath, password, workDir } = await req.json();
  if (!name || !host || !username || !workDir) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const created = createRemoteHost({ name, host, port, username, authType, keyPath, password, workDir });
  const { password: _p, ...safe } = created;
  return NextResponse.json(toApi(safe), { status: 201 });
}
