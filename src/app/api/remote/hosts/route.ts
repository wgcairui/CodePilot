import { NextResponse } from 'next/server';
import { listRemoteHosts, createRemoteHost } from '@/lib/db';

export async function GET() {
  const hosts = listRemoteHosts().map(({ password: _p, ...h }) => h);
  return NextResponse.json(hosts);
}

export async function POST(req: Request) {
  const { name, host, port, username, authType, keyPath, workDir } = await req.json();
  if (!name || !host || !username || !workDir) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const created = createRemoteHost({ name, host, port, username, authType, keyPath, workDir });
  const { password: _p, ...safe } = created;
  return NextResponse.json(safe, { status: 201 });
}
