import { NextResponse } from 'next/server';
import { getDb, getDbSizeMb } from '@/lib/db';

export async function GET() {
  const db = getDb();

  const row = db.prepare('SELECT COUNT(*) as count FROM chat_sessions').get() as { count: number };
  const mem = process.memoryUsage();

  return NextResponse.json({
    totalSessions: row.count,
    dbSizeMb: Math.round(getDbSizeMb() * 10) / 10,
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
  });
}
