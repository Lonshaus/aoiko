import { db } from './db';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import type { Account } from './types';
import { isIntegerYear } from './year-accounts';
// マスタ勘定科目を DB へ反映する（起動毎に呼ぶ）。
// - DB が空：全件投入（初回シード）
// - 既存：マスタに有り DB に無い科目を追加し、既存科目はマスタ由来の項目
//   （name/category/taxCategory/parentCode/displayOrder）を更新する。
//   利用者が切り替える isActive は保持する。仕訳が参照しうるため削除はしない。
// - マスタの年度以外で DB に科目がある年度にも、マスタを同じ規則で反映する。
// 科目表を更新しても seedIfEmpty 方式では既存利用者の DB に新科目が入らなかったため、
// その差分を埋める。
// 読み取りも書き込みと同じ rw トランザクションで行う。複数タブが同時に起動しても、
// 同じ科目の重複追加や、他タブで切り替えた isActive の上書きが起きないようにするため。
export async function seedAndReconcileAccounts(
  master: Account[] = ACCOUNTS_2026,
): Promise<{ added: number; updated: number }> {
  return db.transaction('rw', db.accounts, async () => {
    // 整数でない年度の行（復元で入り込んだ文字列の '2027' など）は読まず、触らず、科目も足さない。
    // IndexedDB では数値の 2027 と別の行なのに同じ鍵で突き合わせると、数値の行の isActive を
    // 上書きしてしまう。こうした行は点検が一覧に出す。
    const existing = (await db.accounts.toArray()).filter((a) => isIntegerYear(a.year));
    const byKey = new Map(existing.map((a) => [`${a.code}__${a.year}`, a]));
    const masterYears = new Set(master.map((m) => m.year));
    const otherYears = [...new Set(existing.map((a) => a.year))].filter((y) => !masterYears.has(y));
    const targets = [
      ...master,
      ...otherYears.flatMap((year) => master.map((m) => ({ ...m, year }))),
    ];

    const toAdd: Account[] = [];
    const toPut: Account[] = [];
    for (const m of targets) {
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
        cur.displayOrder !== m.displayOrder ||
        cur.incomeType !== m.incomeType;
      if (masterFieldsChanged) {
        // マスタ由来の項目を反映しつつ、利用者の isActive は保持する。
        toPut.push({
          ...m,
          ...(cur.isActive !== undefined ? { isActive: cur.isActive } : {}),
        });
      }
    }

    if (toAdd.length > 0) {
      await db.accounts.bulkAdd(toAdd);
    }
    if (toPut.length > 0) {
      await db.accounts.bulkPut(toPut);
    }
    return { added: toAdd.length, updated: toPut.length };
  });
}
