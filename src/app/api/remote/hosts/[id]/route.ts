import { NextResponse } from 'next/server';
import { getRemoteHost, updateRemoteHost, deleteRemoteHost } from '@/lib/db';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const host = getRemoteHost(id);
  if (!host) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { password: _p, ...safe } = host;
  return NextResponse.json(safe);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const { password: _p, id: _id, created_at: _ca, ...updates } = body;
  updateRemoteHost(id, updates);
  const updated = getRemoteHost(id);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { password: _p2, ...safe } = updated;
  return NextResponse.json(safe);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteRemoteHost(id);
  return NextResponse.json({ ok: true });
}
