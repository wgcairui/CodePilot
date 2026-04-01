import { NextResponse } from 'next/server';
import { getDb, cleanupOldSessions } from '@/lib/db';
import { getSystemStats } from '../_helpers';

export async function POST() {
  const { deletedCount } = cleanupOldSessions(30);

  // Compact WAL file to release disk space back to the OS
  getDb().pragma('wal_checkpoint(TRUNCATE)');

  return NextResponse.json({ sessionsDeleted: deletedCount, ...getSystemStats() });
}
