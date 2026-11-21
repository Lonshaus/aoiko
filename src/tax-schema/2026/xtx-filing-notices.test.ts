import { describe, expect, test } from 'vitest';
import {
  buildFilingNoticeValues,
  filingNoticeRows,
  XtxFilingNoticeTextTooLongError,
  type XtxFilingNotices,
  type XtxFilingNoticeTags,
  type XtxMethodApplication,
} from './xtx-filing-notices';
import { buildFormFragment } from './xtx-document';
import { maxOccursOf } from './xtx-mapping-shared';
import type { XtxSchema } from './xtx-schema';

const TAGS: XtxFilingNoticeTags = {
  closure: 'AMJ00010',
  closureDate: 'AMJ00020',
  withdrawal: 'AMJ00030',
  withdrawalYear: 'AMJ00040',
  numberBlock: 'AMJ00050',
  numberKubun: 'AMJ00060',
  detailBlock: 'AMM00000',
  detailKind: 'AMM00010',
  detailAssetType: 'AMM00020',
  detailBusinessOrAssetType: 'AMM00030',
  detailAssetClass: 'AMM00040',
  detailNewMethod: 'AMM00050',
  detailCurrentGroup: 'AMM00060',
  detailCurrentMethod: 'AMM00070',
  detailCurrentYear: 'AMM00080',
  detailMemo: 'AMM00090',
};

function schemaOf(): XtxSchema {
  const rows: [number, string, 'branch' | 'leaf', number][] = [
    [0, 'ZZZ900', 'branch', 1],
    [1, 'ZZZ900-1', 'branch', 1],
    [2, TAGS.closure, 'branch', 1],
    [2, TAGS.closureDate, 'branch', 1],
    [2, TAGS.withdrawal, 'branch', 1],
    [2, TAGS.withdrawalYear, 'branch', 1],
    [2, TAGS.numberBlock, 'branch', 4],
    [3, TAGS.numberKubun, 'branch', 1],
    [2, TAGS.detailBlock, 'branch', 3],
    [3, TAGS.detailKind, 'branch', 1],
    [3, TAGS.detailAssetType, 'branch', 1],
    [3, TAGS.detailBusinessOrAssetType, 'leaf', 1],
    [3, TAGS.detailAssetClass, 'leaf', 1],
    [3, TAGS.detailNewMethod, 'leaf', 1],
    [3, TAGS.detailCurrentGroup, 'branch', 1],
    [4, TAGS.detailCurrentMethod, 'leaf', 1],
    [4, TAGS.detailCurrentYear, 'branch', 1],
    [3, TAGS.detailMemo, 'leaf', 1],
  ];
  return {
    meta: {
      formId: 'ZZZ900',
      formName: 'テスト様式',
      namespace: 'http://xml.e-tax.nta.go.jp/XSD/shotoku',
      version: '1.0',
      source: 'test',
      fetchedAt: '2026-11-21',
    },
    refTree: rows.map(([level, tag, kind, maxOccurs], i) => ({
      no: i + 1,
      level,
      tag,
      ja: tag,
      kind,
      idref: '',
      refType: '',
      minOccurs: 0,
      maxOccurs,
    })),
    definitions: [],
  };
}

const schema = schemaOf();
const NUMBER_MAX = maxOccursOf(schema, TAGS.numberBlock);
const DETAIL_MAX = maxOccursOf(schema, TAGS.detailBlock);

function app(overrides: Partial<XtxMethodApplication> = {}): XtxMethodApplication {
  return {
    kind: 'notice',
    assetType: 'inventory',
    businessOrAssetType: '小売業',
    assetClass: '商品',
    newMethod: '最終仕入原価法',
    ...overrides,
  };
}

const ALL_KINDS: [XtxMethodApplication['kind'], XtxMethodApplication['assetType']][] = [
  ['notice', 'inventory'],
  ['notice', 'securities'],
  ['notice', 'crypto'],
  ['notice', 'depreciable'],
  ['change', 'inventory'],
  ['change', 'securities'],
  ['change', 'crypto'],
  ['change', 'depreciable'],
];
// 番号が互いに異なる n 個の要素（番号は 1 から n まで）
function distinctApps(n: number): XtxMethodApplication[] {
  return ALL_KINDS.slice(0, n).map(([kind, assetType], i) =>
    app({ kind, assetType, assetClass: `区分${i + 1}` }),
  );
}

function build(notices: XtxFilingNotices | undefined) {
  return buildFilingNoticeValues(notices, schema, TAGS);
}

describe('buildFilingNoticeValues: 廃業と取りやめ', () => {
  test('廃業は区分 1 と廃業年月日（令和）の raw になる', () => {
    const out = build({ closureDate: '2026-03-31', methodApplications: [] });
    expect(out.raw).toEqual({
      AMJ00010: '<kubun_CD>1</kubun_CD>',
      AMJ00020: '<gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>3</gen:mm><gen:dd>31</gen:dd>',
    });
  });

  test('青色申告の取りやめは区分 1 と取りやめ年分（令和）の raw になる', () => {
    const out = build({ blueReturnWithdrawalYear: 2027, methodApplications: [] });
    expect(out.raw).toEqual({
      AMJ00030: '<kubun_CD>1</kubun_CD>',
      AMJ00040: '<gen:era>5</gen:era><gen:yy>9</gen:yy>',
    });
  });

  test('どちらも無ければ raw は空', () => {
    expect(build({ methodApplications: [] }).raw).toEqual({});
  });

  test('notices が undefined なら五つとも空', () => {
    expect(build(undefined)).toEqual({
      leafValues: {},
      raw: {},
      repeats: {},
      repeatsRaw: {},
      overflow: [],
    });
  });
});

describe('buildFilingNoticeValues: 番号', () => {
  test('届出は 1〜4、変更承認申請は 5〜8 に変換される', () => {
    const all = ALL_KINDS.map(([kind, assetType]) =>
      buildFilingNoticeValues({ methodApplications: [app({ kind, assetType })] }, schema, TAGS),
    );
    expect(all.map((o) => o.repeatsRaw.AMJ00050)).toEqual([
      [{ AMJ00060: '<kubun_CD>1</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>2</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>3</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>4</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>5</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>6</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>7</kubun_CD>' }],
      [{ AMJ00060: '<kubun_CD>8</kubun_CD>' }],
    ]);
  });

  test('同じ番号は一つにまとまり、小さい順に並ぶ', () => {
    const out = build({
      methodApplications: [
        app({ kind: 'change', assetType: 'securities' }),
        app({ kind: 'notice', assetType: 'depreciable' }),
        app({ kind: 'change', assetType: 'securities', assetClass: '別' }),
        app({ kind: 'notice', assetType: 'inventory' }),
      ],
    });
    expect(out.repeats.AMJ00050).toEqual([{}, {}, {}]);
    expect(out.repeatsRaw.AMJ00050).toEqual([
      { AMJ00060: '<kubun_CD>1</kubun_CD>' },
      { AMJ00060: '<kubun_CD>4</kubun_CD>' },
      { AMJ00060: '<kubun_CD>6</kubun_CD>' },
    ]);
  });

  test('要素が無ければ番号も明細も出さない', () => {
    const out = build({ methodApplications: [] });
    expect(out.repeats).toEqual({});
    expect(out.repeatsRaw).toEqual({});
    expect(out.overflow).toEqual([]);
  });
});

describe('buildFilingNoticeValues: 明細', () => {
  test('文字列の欄は leafValues に、区分と採用した年は raw に入り、入力順に並ぶ', () => {
    const out = build({
      methodApplications: [
        app({
          kind: 'change',
          assetType: 'depreciable',
          businessOrAssetType: '建物',
          assetClass: '木造・店舗',
          newMethod: '定額法',
          currentMethod: '定率法',
          currentAdoptedYear: 2020,
          memo: '摘要A',
        }),
        app({ kind: 'notice', assetType: 'crypto', assetClass: '暗号' }),
      ],
    });
    expect(out.repeats.AMM00000).toEqual([
      {
        AMM00030: '建物',
        AMM00040: '木造・店舗',
        AMM00050: '定額法',
        AMM00070: '定率法',
        AMM00090: '摘要A',
      },
      { AMM00030: '小売業', AMM00040: '暗号', AMM00050: '最終仕入原価法' },
    ]);
    expect(out.repeatsRaw.AMM00000).toEqual([
      {
        AMM00010: '<kubun_CD>2</kubun_CD>',
        AMM00020: '<kubun_CD>4</kubun_CD>',
        AMM00080: '<gen:era>5</gen:era><gen:yy>2</gen:yy>',
      },
      { AMM00010: '<kubun_CD>1</kubun_CD>', AMM00020: '<kubun_CD>3</kubun_CD>' },
    ]);
  });

  test.each([
    [1926, '<gen:era>3</gen:era><gen:yy>1</gen:yy>'],
    [1988, '<gen:era>3</gen:era><gen:yy>63</gen:yy>'],
    [1989, '<gen:era>4</gen:era><gen:yy>1</gen:yy>'],
    [2018, '<gen:era>4</gen:era><gen:yy>30</gen:yy>'],
    [2019, '<gen:era>5</gen:era><gen:yy>1</gen:yy>'],
  ])('採用した年 %i の元号と和暦年', (year, expected) => {
    const out = build({ methodApplications: [app({ currentAdoptedYear: year })] });
    expect(out.repeatsRaw.AMM00000?.[0]?.AMM00080).toBe(expected);
  });

  test('currentAdoptedYear が無ければ採用した年を出さない', () => {
    const out = build({ methodApplications: [app({ currentMethod: '定率法' })] });
    expect(out.repeatsRaw.AMM00000?.[0]).not.toHaveProperty('AMM00080');
  });

  test('明細の上限と同じ数の番号違いの要素は、番号も明細も全部書く', () => {
    const out = build({ methodApplications: distinctApps(DETAIL_MAX) });
    expect(out.repeats.AMM00000).toHaveLength(DETAIL_MAX);
    expect(out.repeats.AMJ00050).toHaveLength(DETAIL_MAX);
    expect(out.overflow).toEqual([]);
  });
});

describe('buildFilingNoticeValues: 上限を超えたとき', () => {
  test('ケース A：明細の上限＋1 個（番号は全部が上限内）は、明細の超過 1 行だけ提示する', () => {
    const apps = distinctApps(DETAIL_MAX + 1);
    expect(apps.length).toBeLessThanOrEqual(NUMBER_MAX);
    const out = build({ methodApplications: apps });
    expect(out.repeats.AMJ00050).toHaveLength(apps.length);
    expect(out.repeats.AMM00000).toHaveLength(DETAIL_MAX);
    expect(out.overflow).toEqual([{ section: 'filingNotice', label: `区分${DETAIL_MAX + 1}` }]);
  });

  test('ケース B：番号の上限＋1 個の要素は、番号 1 行と明細（要素数 − 明細の上限）行を提示する', () => {
    const apps = distinctApps(NUMBER_MAX + 1);
    const out = build({ methodApplications: apps });
    expect(out.repeats.AMJ00050).toHaveLength(NUMBER_MAX);
    expect(out.repeats.AMM00000).toHaveLength(DETAIL_MAX);
    expect(out.overflow).toHaveLength(1 + (apps.length - DETAIL_MAX));
    expect(out.overflow).toEqual([
      { section: 'filingNotice', label: '棚卸資産の評価方法の変更承認申請' },
      { section: 'filingNotice', label: `区分${DETAIL_MAX + 1}` },
      { section: 'filingNotice', label: `区分${DETAIL_MAX + 2}` },
    ]);
  });

  test('提示行には金額が付かない', () => {
    const out = build({ methodApplications: distinctApps(NUMBER_MAX + 1) });
    for (const row of out.overflow) {
      expect(row).not.toHaveProperty('amount');
    }
  });

  test('assetClass が空の明細の提示は番号名称になる', () => {
    const out = build({
      methodApplications: [
        ...distinctApps(DETAIL_MAX),
        app({ kind: 'change', assetType: 'crypto', assetClass: '' }),
      ],
    });
    expect(out.overflow.map((r) => r.label)).toEqual(['暗号資産の評価方法の変更承認申請']);
  });
});

describe('buildFilingNoticeValues: 文字数の上限', () => {
  const long = (n: number): string => 'あ'.repeat(n);

  test.each([
    ['AMM00030', 20, { businessOrAssetType: long(21) }],
    ['AMM00040', 40, { assetClass: long(41) }],
    ['AMM00050', 20, { newMethod: long(21) }],
    ['AMM00070', 20, { currentMethod: long(21) }],
    ['AMM00090', 40, { memo: long(41) }],
  ])('%s は %i 文字を超えると丸めずに投げる', (tag, max, overrides) => {
    const notices = { methodApplications: [app(overrides)] };
    expect(() => build(notices)).toThrow(XtxFilingNoticeTextTooLongError);
    try {
      build(notices);
    } catch (e) {
      expect(e).toMatchObject({ tag, max });
    }
  });

  test('上限ちょうどの長さは通る', () => {
    const out = build({
      methodApplications: [
        app({
          businessOrAssetType: long(20),
          assetClass: long(40),
          newMethod: long(20),
          currentMethod: long(20),
          memo: long(40),
        }),
      ],
    });
    expect(out.repeats.AMM00000?.[0]?.AMM00090).toHaveLength(40);
  });

  test('サロゲートペアは 1 文字と数える', () => {
    const out = build({ methodApplications: [app({ businessOrAssetType: '𠮷'.repeat(20) })] });
    expect(out.repeats.AMM00000).toHaveLength(1);
  });

  test('上限を超えて書かれない要素は文字数を検査しない', () => {
    const out = build({
      methodApplications: [...distinctApps(DETAIL_MAX), app({ memo: long(41) })],
    });
    expect(out.overflow).toHaveLength(1);
  });
});

describe('buildFilingNoticeValues の出力を buildFormFragment へ渡す', () => {
  test('二つの明細がそれぞれの区分と年分で出力される', () => {
    const out = build({
      closureDate: '2026-12-31',
      methodApplications: [
        app({
          kind: 'change',
          assetType: 'depreciable',
          assetClass: '建物',
          currentAdoptedYear: 2018,
        }),
        app({
          kind: 'notice',
          assetType: 'securities',
          assetClass: '株',
          currentAdoptedYear: 1980,
        }),
      ],
    });
    const frag = buildFormFragment(
      schema,
      {},
      {},
      out.leafValues,
      out.repeats,
      out.raw,
      out.repeatsRaw,
    );
    const details = frag.match(/<AMM00000>.*?<\/AMM00000>/g) ?? [];
    expect(details).toHaveLength(2);
    expect(details[0]).toContain('<AMM00010><kubun_CD>2</kubun_CD></AMM00010>');
    expect(details[0]).toContain('<AMM00020><kubun_CD>4</kubun_CD></AMM00020>');
    expect(details[0]).toContain(
      '<AMM00060><AMM00080><gen:era>4</gen:era><gen:yy>30</gen:yy></AMM00080></AMM00060>',
    );
    expect(details[1]).toContain('<AMM00010><kubun_CD>1</kubun_CD></AMM00010>');
    expect(details[1]).toContain('<AMM00020><kubun_CD>2</kubun_CD></AMM00020>');
    expect(details[1]).toContain(
      '<AMM00060><AMM00080><gen:era>3</gen:era><gen:yy>55</gen:yy></AMM00080></AMM00060>',
    );
    expect(frag).toContain('<AMJ00010><kubun_CD>1</kubun_CD></AMJ00010>');
    expect(frag.match(/<AMJ00050>/g)).toHaveLength(2);
  });
});

describe('filingNoticeRows', () => {
  test('廃業・取りやめ・番号・明細の順に全部を列挙する', () => {
    const rows = filingNoticeRows({
      closureDate: '2026-03-31',
      blueReturnWithdrawalYear: 2027,
      methodApplications: [
        app({ kind: 'change', assetType: 'securities', assetClass: '株式' }),
        app({ kind: 'notice', assetType: 'depreciable', assetClass: '' }),
        app({ kind: 'change', assetType: 'securities', assetClass: '社債' }),
      ],
    });
    expect(rows).toEqual([
      { section: 'filingNotice', label: '廃業（2026.03.31）' },
      { section: 'filingNotice', label: '青色申告の取りやめ（2027年分）' },
      { section: 'filingNotice', label: '減価償却資産の償却方法の届出' },
      { section: 'filingNotice', label: '有価証券の評価方法の変更承認申請' },
      { section: 'filingNotice', label: '株式' },
      { section: 'filingNotice', label: '減価償却資産の償却方法の届出' },
      { section: 'filingNotice', label: '社債' },
    ]);
  });

  test('内容が無ければ空', () => {
    expect(filingNoticeRows({ methodApplications: [] })).toEqual([]);
  });
});
