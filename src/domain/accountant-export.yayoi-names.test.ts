import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Encoding from 'encoding-japanese';
import { db } from '../db/db';
import { parseCsv } from '../lib/csv';
import { toIndexable } from '../lib/decimal';
import { ACCOUNTS_2026 } from '../tax-schema/2026';
import {
  encodeShiftJis,
  exportGenericCsv,
  exportYayoiCsv,
  exportYayoiCsvParts,
  type YayoiExportNotice,
} from './accountant-export';

interface Seed {
  id: string;
  description?: string;
  department?: string;
  debit?: string;
  credit?: string;
  debitSub?: string;
}

async function addEntry(seed: Seed): Promise<void> {
  await db.journalEntries.add({
    id: seed.id,
    date: '2026-04-15',
    year: 2026,
    description: seed.description ?? 'テスト仕訳',
    status: 'confirmed',
    source: 'manual',
    createdAt: 0,
    confirmedAt: 0,
    ...(seed.department === undefined ? {} : { department: seed.department }),
  });
  const base = {
    entryId: seed.id,
    amount: '1000',
    amountIndexed: toIndexable('1000'),
    taxRate: 0,
    taxIncluded: true,
    invoiceCompliant: false,
  };
  await db.journalLines.bulkAdd([
    {
      ...base,
      id: `${seed.id}d`,
      side: 'debit',
      accountCode: seed.debit ?? '5130',
      ...(seed.debitSub === undefined ? {} : { subAccountId: seed.debitSub }),
    },
    { ...base, id: `${seed.id}c`, side: 'credit', accountCode: seed.credit ?? '1130' },
  ]);
}

async function addSubAccount(id: string, name: string): Promise<void> {
  await db.subAccounts.add({ id, accountCode: '5130', name });
}

function decode(bytes: Uint8Array): string {
  return Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: 'SJIS', type: 'string' });
}

async function partsRows(options?: {
  includeDepartment?: boolean;
}): Promise<{ rows: string[][]; text: string; notices: YayoiExportNotice[] }> {
  const { parts, notices } = await exportYayoiCsvParts(2026, options);
  expect(parts).toHaveLength(1);
  const text = decode(parts[0]!);
  return { rows: parseCsv(text), text, notices };
}

function hasLengthNotice(notices: YayoiExportNotice[]): boolean {
  return notices.some((n) => n.reasons.includes('length'));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.accounts.bulkAdd(ACCOUNTS_2026);
});

afterEach(async () => {
  await db.delete();
});

describe('弥生形式の部門', () => {
  test('既定では部門を書き出さず、includeDepartment: true のときだけ書き出す', async () => {
    await addEntry({ id: 'e1', department: '営業' });

    const omitted = await partsRows();
    expect(omitted.rows[0]?.[6]).toBe('');
    expect(omitted.rows[0]?.[12]).toBe('');

    const included = await partsRows({ includeDepartment: true });
    expect(included.rows[0]?.[6]).toBe('営業');
    expect(included.rows[0]?.[12]).toBe('営業');
  });

  test('汎用 CSV は部門をこれまでどおり書き出す', async () => {
    await addEntry({ id: 'e1', department: '営業' });

    const text = new TextDecoder().decode(await exportGenericCsv(2026));
    expect(parseCsv(text)[1]?.[3]).toBe('営業');
  });

  test('includeDepartment: true の分割出力は exportYayoiCsv と同じバイト列になる', async () => {
    await addEntry({ id: 'e1', department: '営業', description: '電気代' });
    await addEntry({ id: 'e2', department: '本店', description: '水道代' });

    const { parts } = await exportYayoiCsvParts(2026, { includeDepartment: true });
    expect(parts).toHaveLength(1);
    expect(Array.from(parts[0]!)).toEqual(Array.from(await exportYayoiCsv(2026)));
  });

  test('選択しない分割出力は部門欄が空で、exportYayoiCsv は部門を書き出す', async () => {
    await addEntry({ id: 'e1', department: '営業' });

    const omitted = await partsRows();
    expect(omitted.rows[0]?.[6]).toBe('');
    const whole = parseCsv(decode(await exportYayoiCsv(2026)));
    expect(whole[0]?.[6]).toBe('営業');
    expect(whole[0]?.[12]).toBe('営業');
  });
});

describe('弥生形式の名前の前後の空白', () => {
  test('補助科目と部門は前後の空白とタブを除き、摘要はタブだけを空白にする', async () => {
    await addSubAccount('s1', ' 現金 ');
    await addEntry({ id: 'e1', department: ' 営業\t', description: '\t前後 ', debitSub: 's1' });

    const { rows } = await partsRows({ includeDepartment: true });
    const row = rows[0]!;
    expect(row[5]).toBe('現金');
    expect(row[6]).toBe('営業');
    expect(row[12]).toBe('営業');
    expect(row[16]).toBe(' 前後 ');
  });

  test('全角空白も前後から除く', async () => {
    await addSubAccount('s1', '　現金　');
    await addEntry({ id: 'e1', debitSub: 's1' });

    const { rows } = await partsRows();
    expect(rows[0]?.[5]).toBe('現金');
  });
});

describe('弥生形式の " と ;', () => {
  test('摘要の " と ; を全角にし、引用符で囲む欄を作らない', async () => {
    await addEntry({ id: 'e1', description: 'A"B;C' });

    const { rows, text } = await partsRows();
    expect(rows[0]?.[16]).toBe('A”B；C');
    expect(text).not.toContain('"');
    expect(rows.every((r) => r.length === 25)).toBe(true);
  });
});

describe('弥生形式の名前の長さ', () => {
  const SHORT_NAMES: [string, string, string][] = [
    ['5810', '貸倒引当金繰入額（一括評価）', '貸倒引当金繰入一括'],
    ['5811', '貸倒引当金繰入額（個別評価）', '貸倒引当金繰入個別'],
    ['5410', '貸倒引当金繰入額（不動産）', '貸倒引当金繰入不動産'],
    ['4230', '貸倒引当金繰戻額（不動産）', '貸倒引当金繰戻不動産'],
    ['4220', '礼金・権利金等（不動産）', '礼金・権利金等不動産'],
  ];

  test('科目表の名前はそのままで、弥生形式では 24 バイト・10 文字以内の別々の名前で書き出す', async () => {
    for (const [code, masterName] of SHORT_NAMES) {
      expect(ACCOUNTS_2026.find((a) => a.code === code)?.name).toBe(masterName);
    }
    await addEntry({ id: 'e1', debit: '5810' });
    await addEntry({ id: 'e2', debit: '5811' });
    await addEntry({ id: 'e3', debit: '5410' });
    await addEntry({ id: 'e4', debit: '1130', credit: '4230' });
    await addEntry({ id: 'e5', debit: '1130', credit: '4220' });

    const { rows, notices } = await partsRows();
    expect(rows.map((r) => (r[4] === '普通預金' ? r[10] : r[4]))).toEqual(
      SHORT_NAMES.map(([, , short]) => short),
    );
    for (const [, , short] of SHORT_NAMES) {
      expect(encodeShiftJis(short).length).toBeLessThanOrEqual(24);
      expect([...short].length).toBeLessThanOrEqual(10);
    }
    expect(new Set(SHORT_NAMES.map(([, , short]) => short)).size).toBe(SHORT_NAMES.length);
    expect(hasLengthNotice(notices)).toBe(false);
  });

  test('ACCOUNTS_2026 のどの科目の仕訳も長さの注意を出さない', async () => {
    for (const account of ACCOUNTS_2026) {
      await addEntry({ id: `a${account.code}`, debit: account.code });
    }

    const { rows, notices } = await partsRows();
    expect(rows).toHaveLength(ACCOUNTS_2026.length);
    expect(notices.filter((n) => n.reasons.includes('length'))).toEqual([]);
  });

  test('汎用 CSV は科目表の名前のまま書き出す', async () => {
    await addEntry({ id: 'e1', debit: '5810' });

    const text = new TextDecoder().decode(await exportGenericCsv(2026));
    expect(parseCsv(text).find((r) => r[5] === '5810')?.[6]).toBe('貸倒引当金繰入額（一括評価）');
  });

  test('全角 13 文字の補助科目は長さの注意を出す', async () => {
    await addSubAccount('s1', 'あ'.repeat(13));
    await addEntry({ id: 'e1', debitSub: 's1' });

    const { notices } = await partsRows();
    expect(hasLengthNotice(notices)).toBe(true);
  });

  test("先頭に ' が付いて 25 バイトになる補助科目は長さの注意を出す", async () => {
    await addSubAccount('s1', `=${'あ'.repeat(11)}a`);
    await addEntry({ id: 'e1', debitSub: 's1' });

    const { rows, notices } = await partsRows();
    expect(encodeShiftJis(rows[0]![5]!).length).toBe(25);
    expect(hasLengthNotice(notices)).toBe(true);
  });

  test("' が付かない 24 バイトの補助科目は長さの注意を出さない", async () => {
    await addSubAccount('s1', `b${'あ'.repeat(11)}a`);
    await addEntry({ id: 'e1', debitSub: 's1' });

    const { notices } = await partsRows();
    expect(hasLengthNotice(notices)).toBe(false);
  });

  test('半角 16 文字の補助科目は長さの注意を出し、15 文字は出さない', async () => {
    await addSubAccount('s16', 'abcdefghijklmnop');
    await addEntry({ id: 'e1', debitSub: 's16' });
    expect(hasLengthNotice((await partsRows()).notices)).toBe(true);

    await db.journalLines.update('e1d', { subAccountId: 's15' });
    await addSubAccount('s15', 'abcdefghijklmno');
    expect(hasLengthNotice((await partsRows()).notices)).toBe(false);
  });

  test('半角 11 文字の科目は長さの注意を出し、10 文字は出さない', async () => {
    await db.accounts.add({
      code: '5990',
      year: 2026,
      name: 'ABCDEFGHIJK',
      category: 'expense',
      displayOrder: 990,
    });
    await addEntry({ id: 'e1', debit: '5990' });
    expect(hasLengthNotice((await partsRows()).notices)).toBe(true);

    await db.accounts.update(['5990', 2026], { name: 'ABCDEFGHIJ' });
    expect(hasLengthNotice((await partsRows()).notices)).toBe(false);
  });

  test('全角 13 文字の部門は、部門を書き出すときだけ長さの注意を出す', async () => {
    await addEntry({ id: 'e1', department: 'い'.repeat(13) });

    expect(hasLengthNotice((await partsRows({ includeDepartment: true })).notices)).toBe(true);
    expect(hasLengthNotice((await partsRows()).notices)).toBe(false);
  });
});
