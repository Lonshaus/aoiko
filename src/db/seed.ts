import { db } from './db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.accounts.where({ year: 2026 }).count();
  if (existing > 0) {
    return;
  }
  await db.accounts.bulkPut(ACCOUNTS_2026);
}