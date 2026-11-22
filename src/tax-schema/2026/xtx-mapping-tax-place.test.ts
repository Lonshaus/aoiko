import { describe, expect, test } from 'vitest';
import { buildXtx2026, type XtxContext, type XtxFiler } from './xtx';
import { mapKoa020LeafValues } from './xtx-mapping-koa020';
import { mapKoa110Values } from './xtx-mapping-koa110';
import { mapKoa210Values } from './xtx-mapping-koa210';

const baseFiler: XtxFiler = {
  riyoshaId: '1234567890123456',
  name: '青色 太郎',
  zip: '1000001',
  address: '東京都千代田区1-1',
  zeimushoCode: '01101',
  zeimushoName: '麹町',
};

function ctx(filer: Partial<XtxFiler>, filingType: 'blue' | 'white' = 'blue'): XtxContext {
  return {
    year: 2026,
    businessName: '青色商店',
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
    filer: { ...baseFiler, ...filer },
    filingType,
    aoiroDeductionKind: filingType === 'blue' ? 'electronic' : 'none',
    fixedAssets: [],
  };
}

describe('KOA020 ABA00095（住所・下段）', () => {
  test('区分が住所地なら書かない', () => {
    expect(mapKoa020LeafValues(ctx({ taxPlaceKind: 'domicile' })).ABA00095).toBeUndefined();
  });

  test('区分が無ければ住所地として書かない', () => {
    expect(
      mapKoa020LeafValues(ctx({ domicileAddress: '大阪府大阪市1-1' })).ABA00095,
    ).toBeUndefined();
  });

  test.each(['abode', 'businessPlace'] as const)('区分が %s なら住所を書く', (kind) => {
    const leaf = mapKoa020LeafValues(
      ctx({ taxPlaceKind: kind, address: '京都府京都市1-1', domicileAddress: '大阪府大阪市1-1' }),
    );
    expect(leaf.ABA00095).toBe('大阪府大阪市1-1');
  });

  test('区分が住所地以外でも住所が空なら書かない', () => {
    expect(mapKoa020LeafValues(ctx({ taxPlaceKind: 'abode' })).ABA00095).toBeUndefined();
  });

  test('白色申告でも同じに書く', () => {
    const leaf = mapKoa020LeafValues(
      ctx({ taxPlaceKind: 'abode', domicileAddress: '大阪府大阪市1-1' }, 'white'),
    );
    expect(leaf.ABA00095).toBe('大阪府大阪市1-1');
  });
});

describe.each([
  ['KOA210（青色）', mapKoa210Values, 'AMB00010', 'AMB00050', 'blue'],
  ['KOA110（白色）', mapKoa110Values, 'AIB00010', 'AIB00050', 'white'],
] as const)('%s の住所と事業所所在地', (_name, map, domicileTag, businessTag, filingType) => {
  test('住所地なら住所に納税地を書き、事業所所在地は書かない', () => {
    const leaf = map(ctx({ taxPlaceKind: 'domicile' }, filingType));
    expect(leaf[domicileTag]).toBe('東京都千代田区1-1');
    expect(leaf[businessTag]).toBeUndefined();
  });

  test('区分が無い保存値も住所地として同じに書く', () => {
    const leaf = map(ctx({}, filingType));
    expect(leaf[domicileTag]).toBe('東京都千代田区1-1');
    expect(leaf[businessTag]).toBeUndefined();
  });

  test('居所なら住所に別に持つ住所を書き、事業所所在地は書かない', () => {
    const leaf = map(
      ctx(
        { taxPlaceKind: 'abode', address: '京都府京都市1-1', domicileAddress: '大阪府大阪市1-1' },
        filingType,
      ),
    );
    expect(leaf[domicileTag]).toBe('大阪府大阪市1-1');
    expect(leaf[businessTag]).toBeUndefined();
  });

  test('事業所等で事業所所在地の入力が無ければ納税地を事業所所在地に書く', () => {
    const leaf = map(
      ctx(
        {
          taxPlaceKind: 'businessPlace',
          address: '京都府京都市1-1',
          domicileAddress: '大阪府大阪市1-1',
        },
        filingType,
      ),
    );
    expect(leaf[domicileTag]).toBe('大阪府大阪市1-1');
    expect(leaf[businessTag]).toBe('京都府京都市1-1');
  });

  test.each(['domicile', 'abode', 'businessPlace'] as const)(
    '事業所所在地の入力があれば区分 %s でもそれを書く',
    (kind) => {
      const leaf = map(
        ctx(
          {
            taxPlaceKind: kind,
            address: '京都府京都市1-1',
            domicileAddress: '大阪府大阪市1-1',
            businessPlaceAddress: '兵庫県神戸市1-1',
          },
          filingType,
        ),
      );
      expect(leaf[businessTag]).toBe('兵庫県神戸市1-1');
    },
  );

  test('住所が空なら住所の欄を書かない', () => {
    const leaf = map(ctx({ taxPlaceKind: 'abode' }, filingType));
    expect(leaf[domicileTag]).toBeUndefined();
  });
});

describe('.xtx への出力', () => {
  test('居所を納税地にすると、IT部は納税地・第一表の下段と決算書は住所を出す', () => {
    const xtx = buildXtx2026(
      ctx({
        taxPlaceKind: 'abode',
        address: '京都府京都市1-1',
        domicileAddress: '大阪府&大阪市1-1',
      }),
    );
    expect(xtx).toContain('<NOZEISHA_ADR ID="NOZEISHA_ADR">京都府京都市1-1</NOZEISHA_ADR>');
    expect(xtx).toContain('<ABA00095>大阪府&amp;大阪市1-1</ABA00095>');
    expect(xtx).toContain('<AMB00010>大阪府&amp;大阪市1-1</AMB00010>');
    expect(xtx).not.toContain('<AMB00050>');
  });

  test('住所地なら下段を出さず、決算書の住所に納税地を出す', () => {
    const xtx = buildXtx2026(ctx({}));
    expect(xtx).toContain('<NOZEISHA_ADR ID="NOZEISHA_ADR">東京都千代田区1-1</NOZEISHA_ADR>');
    expect(xtx).not.toContain('<ABA00095>');
    expect(xtx).toContain('<AMB00010>東京都千代田区1-1</AMB00010>');
  });

  test('白色申告の収支内訳書にも住所と事業所所在地を出す', () => {
    const xtx = buildXtx2026(
      ctx(
        {
          taxPlaceKind: 'businessPlace',
          address: '京都府京都市1-1',
          domicileAddress: '大阪府大阪市1-1',
        },
        'white',
      ),
    );
    expect(xtx).toContain('<AIB00010>大阪府大阪市1-1</AIB00010>');
    expect(xtx).toContain('<AIB00050>京都府京都市1-1</AIB00050>');
  });
});
