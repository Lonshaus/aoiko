import { db } from './db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import type { Account } from './types';
// マスタ勘定科目を DB へ反映する（起動毎に呼ぶ）。
// - DB が空：全件投入（初回シード）
// - 既存：マスタに有り DB に無い科目を追加し、既存科目はマスタ由来の項目
//   （name/category/taxCategory/parentCode/displayOrder）を更新する。
//   利用者が切り替える isActive は保持する。仕訳が参照しうるため削除はしない。
// 科目表を更新しても seedIfEmpty 方式では既存利用者の DB に新科目が入らなかったため、
// その差分を埋める。
export async function seedAndReconcileAccounts(
  master: Account[] = ACCOUNTS_2026
): Promise<{ added: number; updated: number }> {
  const existing = await db.accounts.toArray();
  const byKey = new Map(existing.map((a) => [`${a.code}__${a.year}`, a]));

  const toAdd: Account[] = [];
  const toPut: Account[] = [];
  for (const m of master) {
    const cur = byKey.get(`${m.code}__${m.year}`);
    if (!cur) {
      toAdd.push(m);
      continue;
    }
    const masterFieldsChanged =
      cur.name !== m.name ||
      cur.category !== m.category ||
      cur.taxCategory !== m.taxCategory ||
      cur.parentCode !== m.parentCode ||
      cur.displayOrder !== m.displayOrder;
    if (masterFieldsChanged) {
      // マスタ由来の項目を反映しつつ、利用者の isActive は保持する。
      toPut.push({
        ...m,
        ...(cur.isActive !== undefined ? { isActive: cur.isActive } : {}),
      });
    }
  }

  if (toAdd.length === 0 && toPut.length === 0) {
    return { added: 0, updated: 0 };
  }
  await db.transaction('rw', db.accounts, async () => {
    if (toAdd.length > 0) {
      await db.accounts.bulkAdd(toAdd);
    }
    if (toPut.length > 0) {
      await db.accounts.bulkPut(toPut);
    }
  });
  return { added: toAdd.length, updated: toPut.length };
}