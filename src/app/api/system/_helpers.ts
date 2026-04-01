import { getDbSizeMb } from '@/lib/db';

export interface SystemStats {
  dbSizeMb: number;
  rssMb: number;
  heapUsedMb: number;
}

export function getSystemStats(): SystemStats {
  const mem = process.memoryUsage();
  return {
    dbSizeMb: Math.round(getDbSizeMb() * 10) / 10,
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
  };
}
