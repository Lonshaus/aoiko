// 実 W3C XSD validation テスト。
// 生成した参照側（帳票個別部分）サブツリーを、国税庁公式 xsd
// （docs/xtx-spec/shotoku/KOA0NN-0NN.xsd）へ非公式 include ラッパ経由で
// xmllint --schema により検証する。
//
// xmllint（libxml2）が無い環境では skip（CI は libxml2-utils を導入し強制）。
// 注：IT部 + 参照側を結合した IDREF 整合まで含む完全検証は ITdefinition.xsd の
// 名前空間/型解決が intricate なため Sub E（実エンベロープ・e-Tax 実機）で扱う。
// 本テストは Sub C/D の mapping 誤りが集中する参照側の構造・型・FormAttribute を
// 公式 xsd で担保する。
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildXtx2026 } from './xtx';
import { buildFormFragment, type XtxLeafValues } from './xtx-document';
import { mapKoa020LeafValues, mapKoa020Values } from './xtx-mapping-koa020';
import { mapKoa210Values } from './xtx-mapping-koa210';
import { mapKoa110RepeatedValues, mapKoa110Values } from './xtx-mapping-koa110';
import koa020 from './xtx-schema-koa020.generated.json';
import koa210 from './xtx-schema-koa210.generated.json';
import koa110 from './xtx-schema-koa110.generated.json';
import type { XtxSchema } from './xtx-schema';
import type { BSReport, MonthlyReport, PLReport } from '../../domain/reports';
import type { FixedAsset } from '../../db/types';

const NS = 'http://xml.e-tax.nta.go.jp/XSD/shotoku';
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(HERE, '../../../docs/xtx-spec/shotoku');

function xmllintAvailable(): boolean {
  const r = spawnSync('xmllint', ['--version']);
  return r.error === undefined && r.status === 0;
}

// 第一ページの最初の直接値 leaf に値を入れる（様式出力ゲート通過用）。
function firstPageLeaf(s: XtxSchema): XtxLeafValues {
  let pages = 0;
  let inFirstPage = false;
  for (const e of s.refTree) {
    if (e.level === 1) {
      pages += 1;
      inFirstPage = pages === 1;
      if (pages > 1) {
        break;
      }
    }
    if (inFirstPage && e.kind === 'leaf' && !e.idref) {
      return { [e.tag]: '100' };
    }
  }
  return {};
}

function validate(schema: XtxSchema, wrapper: string): {
  ok: boolean;
  out: string;
} {
  const frag = buildFormFragment(
    schema,
    { NENBUN: '08', ZEIMUSHO: '渋谷' },
    { creatorName: '青井事務所', creationDate: '2026-05-13' },
    firstPageLeaf(schema)
  );
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ValidationRoot xmlns="${NS}">\n${frag}\n</ValidationRoot>\n`;
  const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
  const xmlPath = join(dir, 'doc.xml');
  writeFileSync(xmlPath, doc, 'utf8');
  const r = spawnSync(
    'xmllint',
    ['--noout', '--schema', join(SPEC_DIR, wrapper), xmlPath],
    { encoding: 'utf8' }
  );
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const hasXmllint = xmllintAvailable();
const maybe = hasXmllint ? test : test.skip;

describe('実 XSD validation（公式 xsd / xmllint）', () => {
  if (!hasXmllint) {
    test('xmllint 不在のため skip（CI は libxml2-utils 導入で強制）', () => {
      expect(hasXmllint).toBe(false);
    });
  }

  maybe('KOA210 参照側が公式 xsd に適合する', () => {
    const { ok, out } = validate(
      koa210 as XtxSchema,
      '_valwrap-KOA210.xsd'
    );
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('KOA110 参照側が公式 xsd に適合する', () => {
    const { ok, out } = validate(
      koa110 as XtxSchema,
      '_valwrap-KOA110.xsd'
    );
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('KOA020 参照側が公式 xsd に適合する', () => {
    const { ok, out } = validate(
      koa020 as XtxSchema,
      '_valwrap-KOA020.xsd'
    );
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('KOA020 実 mapping 経路（年分・屋号・営業等収入）が公式 xsd に適合する', () => {
    const ctx = {
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly: {
        year: 2026,
        months: [],
        totalSales: '0',
        totalExpense: '0',
      },
      pl: {
        year: 2026,
        revenue: [],
        expense: [],
        totalRevenue: '5000000',
        totalExpense: '0',
        netIncome: '5000000',
        entryCount: 0,
      },
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [],
        liabilities: [],
        equity: [],
        netIncome: '5000000',
        totalAssets: '0',
        totalLiabilitiesAndEquity: '0',
        balanced: true,
      },
      filer: { riyoshaId: '', name: '', zip: '', address: '', zeimushoCode: '', zeimushoName: '' },
      filingType: 'blue' as const,
      aoiroDeductionKind: 'electronic' as const,
      fixedAssets: [],
    };
    const values = mapKoa020Values(ctx);
    const frag = buildFormFragment(
      koa020 as XtxSchema,
      values,
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      mapKoa020LeafValues(ctx)
    );
    const doc =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ValidationRoot xmlns="${NS}">\n${frag}\n</ValidationRoot>\n`;
    const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
    const xmlPath = join(dir, 'doc.xml');
    writeFileSync(xmlPath, doc, 'utf8');
    const r = spawnSync(
      'xmllint',
      ['--noout', '--schema', join(SPEC_DIR, '_valwrap-KOA020.xsd'), xmlPath],
      { encoding: 'utf8' }
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out).not.toContain('Schemas parser error');
    expect(r.status, out).toBe(0);
  });

  maybe('KOA210 実 mapping 経路（PL/BS/月別）が公式 xsd に適合する', () => {
    const pl: PLReport = {
      year: 2026,
      revenue: [
        {
          accountCode: '4110',
          accountName: '売上高',
          category: 'revenue',
          amount: '5000000',
          displayOrder: 110,
        },
      ],
      expense: [
        {
          accountCode: '5130',
          accountName: '水道光熱費',
          category: 'expense',
          amount: '120000',
          displayOrder: 130,
        },
        {
          accountCode: '5150',
          accountName: '通信費',
          category: 'expense',
          amount: '88000',
          displayOrder: 150,
        },
        {
          accountCode: '5210',
          accountName: '減価償却費',
          category: 'expense',
          amount: '240000',
          displayOrder: 210,
        },
      ],
      totalRevenue: '5000000',
      totalExpense: '448000',
      netIncome: '4552000',
      entryCount: 9,
    };
    const bs: BSReport = {
      year: 2026,
      asOf: '2026-12-31',
      assets: [
        {
          accountCode: '1110',
          accountName: '現金',
          category: 'asset',
          balance: '300000',
        },
        {
          accountCode: '1130',
          accountName: '普通預金',
          category: 'asset',
          balance: '4252000',
        },
      ],
      liabilities: [],
      equity: [
        {
          accountCode: '3110',
          accountName: '元入金',
          category: 'equity',
          balance: '4552000',
        },
      ],
      netIncome: '4552000',
      totalAssets: '4552000',
      totalLiabilitiesAndEquity: '4552000',
      balanced: true,
    };
    const monthly: MonthlyReport = {
      year: 2026,
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        sales: String((i + 1) * 100000),
        expense: String((i + 1) * 10000),
        purchases: String((i + 1) * 3000),
      })),
      totalSales: '7800000',
      totalExpense: '780000',
    };
    const leafValues = mapKoa210Values({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly,
      pl,
      bs,
      filer: { riyoshaId: '', name: '', zip: '', address: '', zeimushoCode: '', zeimushoName: '' },
      filingType: 'blue',
      aoiroDeductionKind: 'electronic',
      fixedAssets: [],
    });
    expect(Object.keys(leafValues).length).toBeGreaterThan(10);
    const frag = buildFormFragment(
      koa210 as XtxSchema,
      {},
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      leafValues
    );
    const doc =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ValidationRoot xmlns="${NS}">\n${frag}\n</ValidationRoot>\n`;
    const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
    const xmlPath = join(dir, 'doc.xml');
    writeFileSync(xmlPath, doc, 'utf8');
    const r = spawnSync(
      'xmllint',
      ['--noout', '--schema', join(SPEC_DIR, '_valwrap-KOA210.xsd'), xmlPath],
      { encoding: 'utf8' }
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out).not.toContain('Schemas parser error');
    expect(r.status, out).toBe(0);
  });

  maybe('KOA110 実 mapping 経路（PL、白色申告）が公式 xsd に適合する', () => {
    const pl: PLReport = {
      year: 2026,
      revenue: [
        {
          accountCode: '4110',
          accountName: '売上高',
          category: 'revenue',
          amount: '5000000',
          displayOrder: 110,
        },
      ],
      expense: [
        {
          accountCode: '5130',
          accountName: '水道光熱費',
          category: 'expense',
          amount: '120000',
          displayOrder: 130,
        },
        {
          accountCode: '5150',
          accountName: '通信費',
          category: 'expense',
          amount: '88000',
          displayOrder: 150,
        },
        {
          accountCode: '5210',
          accountName: '減価償却費',
          category: 'expense',
          amount: '240000',
          displayOrder: 210,
        },
      ],
      totalRevenue: '5000000',
      totalExpense: '448000',
      netIncome: '4552000',
      entryCount: 9,
    };
    const leafValues = mapKoa110Values({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
      pl,
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [],
        liabilities: [],
        equity: [],
        netIncome: '4552000',
        totalAssets: '0',
        totalLiabilitiesAndEquity: '0',
        balanced: true,
      },
      filer: { riyoshaId: '', name: '', zip: '', address: '', zeimushoCode: '', zeimushoName: '' },
      filingType: 'white',
      aoiroDeductionKind: 'none',
      fixedAssets: [],
    });
    expect(Object.keys(leafValues).length).toBeGreaterThan(3);
    const frag = buildFormFragment(
      koa110 as XtxSchema,
      {},
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      leafValues
    );
    const doc =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ValidationRoot xmlns="${NS}">\n${frag}\n</ValidationRoot>\n`;
    const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
    const xmlPath = join(dir, 'doc.xml');
    writeFileSync(xmlPath, doc, 'utf8');
    const r = spawnSync(
      'xmllint',
      ['--noout', '--schema', join(SPEC_DIR, '_valwrap-KOA110.xsd'), xmlPath],
      { encoding: 'utf8' }
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out).not.toContain('Schemas parser error');
    expect(r.status, out).toBe(0);
  });

  maybe('KOA110 第2頁 減価償却資産の明細（繰り返しブロック）が公式 xsd に適合する', () => {
    const fixedAssets: FixedAsset[] = [
      {
        id: 'a1',
        name: 'ノートPC',
        acquisitionDate: '2024-06-01',
        acquisitionCost: '300000',
        usefulLifeYears: 4,
        depreciationMethod: 'straight-line',
        accountCode: '1510',
      },
      {
        id: 'a2',
        name: 'プリンター',
        acquisitionDate: '2026-01-01',
        acquisitionCost: '150000',
        usefulLifeYears: 4,
        depreciationMethod: 'lump-sum',
        accountCode: '1510',
      },
    ];
    const repeats = mapKoa110RepeatedValues({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly: { year: 2026, months: [], totalSales: '0', totalExpense: '0' },
      pl: {
        year: 2026,
        revenue: [],
        expense: [],
        totalRevenue: '0',
        totalExpense: '0',
        netIncome: '0',
        entryCount: 0,
      },
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [],
        liabilities: [],
        equity: [],
        netIncome: '0',
        totalAssets: '0',
        totalLiabilitiesAndEquity: '0',
        balanced: true,
      },
      filer: { riyoshaId: '', name: '', zip: '', address: '', zeimushoCode: '', zeimushoName: '' },
      filingType: 'white',
      aoiroDeductionKind: 'none',
      fixedAssets,
    });
    expect(repeats.AIM00010).toHaveLength(2);
    const frag = buildFormFragment(
      koa110 as XtxSchema,
      {},
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      {},
      repeats
    );
    expect(frag.match(/<AIM00010>/g)).toHaveLength(2);
    // AIM00090（耐用年数）は simpleContent+AutoCalc 型。schema 生成側でこれを
    // 「子の無い branch」と誤判定すると renderNode() が値を握り潰して出力から
    // 消える（実際に発生した回帰）。実際に描画されることを直接確認する。
    expect(frag.match(/<AIM00090>4<\/AIM00090>/g)).toHaveLength(2);
    const doc =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ValidationRoot xmlns="${NS}">\n${frag}\n</ValidationRoot>\n`;
    const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
    const xmlPath = join(dir, 'doc.xml');
    writeFileSync(xmlPath, doc, 'utf8');
    const r = spawnSync(
      'xmllint',
      ['--noout', '--schema', join(SPEC_DIR, '_valwrap-KOA110.xsd'), xmlPath],
      { encoding: 'utf8' }
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out).not.toContain('Schemas parser error');
    expect(r.status, out).toBe(0);
  });

  maybe('組立済バンドル（buildXtx2026）の各様式が公式 xsd に適合する', () => {
    const ctx = {
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly: {
        year: 2026,
        months: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          sales: String((i + 1) * 100000),
          expense: String((i + 1) * 10000),
          purchases: String((i + 1) * 3000),
        })),
        totalSales: '7800000',
        totalExpense: '780000',
      },
      pl: {
        year: 2026,
        revenue: [
          {
            accountCode: '4110',
            accountName: '売上高',
            category: 'revenue' as const,
            amount: '7800000',
            displayOrder: 110,
          },
        ],
        expense: [
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense' as const,
            amount: '120000',
            displayOrder: 130,
          },
        ],
        totalRevenue: '7800000',
        totalExpense: '120000',
        netIncome: '7680000',
        entryCount: 4,
      },
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [
          {
            accountCode: '1110',
            accountName: '現金',
            category: 'asset' as const,
            balance: '7680000',
          },
        ],
        liabilities: [],
        equity: [
          {
            accountCode: '3110',
            accountName: '元入金',
            category: 'equity' as const,
            balance: '7680000',
          },
        ],
        netIncome: '7680000',
        totalAssets: '7680000',
        totalLiabilitiesAndEquity: '7680000',
        balanced: true,
      },
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      filingType: 'blue' as const,
      aoiroDeductionKind: 'electronic' as const,
      fixedAssets: [],
    };
    const xtx = buildXtx2026(ctx);
    // バンドルから各様式サブツリーを抜き出し、各々を公式 xsd で検証
    const forms: Array<[string, string]> = [
      ['KOA020', '_valwrap-KOA020.xsd'],
      ['KOA210', '_valwrap-KOA210.xsd'],
    ];
    for (const [tag, wrapper] of forms) {
      const m = new RegExp(`<${tag} [\\s\\S]*?</${tag}>`).exec(xtx);
      expect(m, `${tag} subtree not found`).not.toBeNull();
      const doc =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<ValidationRoot xmlns="${NS}">\n${m![0]}\n</ValidationRoot>\n`;
      const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
      const xmlPath = join(dir, 'doc.xml');
      writeFileSync(xmlPath, doc, 'utf8');
      const r = spawnSync(
        'xmllint',
        ['--noout', '--schema', join(SPEC_DIR, wrapper), xmlPath],
        { encoding: 'utf8' }
      );
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(out).not.toContain('Schemas parser error');
      expect(r.status, `${tag}: ${out}`).toBe(0);
    }
  });

  maybe('組立済バンドル（buildXtx2026、白色申告）の各様式が公式 xsd に適合する', () => {
    const ctx = {
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      invoiceNumber: '',
      monthly: {
        year: 2026,
        months: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          sales: String((i + 1) * 100000),
          expense: String((i + 1) * 10000),
          purchases: String((i + 1) * 3000),
        })),
        totalSales: '7800000',
        totalExpense: '780000',
      },
      pl: {
        year: 2026,
        revenue: [
          {
            accountCode: '4110',
            accountName: '売上高',
            category: 'revenue' as const,
            amount: '7800000',
            displayOrder: 110,
          },
        ],
        expense: [
          {
            accountCode: '5130',
            accountName: '水道光熱費',
            category: 'expense' as const,
            amount: '120000',
            displayOrder: 130,
          },
        ],
        totalRevenue: '7800000',
        totalExpense: '120000',
        netIncome: '7680000',
        entryCount: 4,
      },
      bs: {
        year: 2026,
        asOf: '2026-12-31',
        assets: [
          {
            accountCode: '1110',
            accountName: '現金',
            category: 'asset' as const,
            balance: '7680000',
          },
        ],
        liabilities: [],
        equity: [
          {
            accountCode: '3110',
            accountName: '元入金',
            category: 'equity' as const,
            balance: '7680000',
          },
        ],
        netIncome: '7680000',
        totalAssets: '7680000',
        totalLiabilitiesAndEquity: '7680000',
        balanced: true,
      },
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      filingType: 'white' as const,
      aoiroDeductionKind: 'none' as const,
      fixedAssets: [],
    };
    const xtx = buildXtx2026(ctx);
    const forms: Array<[string, string]> = [
      ['KOA020', '_valwrap-KOA020.xsd'],
      ['KOA110', '_valwrap-KOA110.xsd'],
    ];
    for (const [tag, wrapper] of forms) {
      const m = new RegExp(`<${tag} [\\s\\S]*?</${tag}>`).exec(xtx);
      expect(m, `${tag} subtree not found`).not.toBeNull();
      const doc =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<ValidationRoot xmlns="${NS}">\n${m![0]}\n</ValidationRoot>\n`;
      const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
      const xmlPath = join(dir, 'doc.xml');
      writeFileSync(xmlPath, doc, 'utf8');
      const r = spawnSync(
        'xmllint',
        ['--noout', '--schema', join(SPEC_DIR, wrapper), xmlPath],
        { encoding: 'utf8' }
      );
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(out).not.toContain('Schemas parser error');
      expect(r.status, `${tag}: ${out}`).toBe(0);
    }
    // KOA210 は白色申告バンドルに含まれない
    expect(xtx).not.toContain('<KOA210 ');
  });
});