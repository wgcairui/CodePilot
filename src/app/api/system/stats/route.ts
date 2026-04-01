import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSystemStats } from '../_helpers';

export async function GET() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM chat_sessions').get() as { count: number };
  return NextResponse.json({ totalSessions: row.count, ...getSystemStats() });
}
