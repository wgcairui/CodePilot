import { NextResponse } from 'next/server';
import { getDb, getDbSizeMb, cleanupOldSessions } from '@/lib/db';

export async function POST() {
  const { deletedCount } = cleanupOldSessions(30);

  // Compact WAL file to release disk space back to the OS
  getDb().pragma('wal_checkpoint(TRUNCATE)');

  const mem = process.memoryUsage();
  return NextResponse.json({
    sessionsDeleted: deletedCount,
    dbSizeMb: Math.round(getDbSizeMb() * 10) / 10,
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
  });
}
