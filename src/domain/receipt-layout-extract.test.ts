// 座標付きの認識結果からの抽出。素のテキストからの抽出は receipt-text-extract.test.ts。
//
// 入力は雛形で、中身はすべて作り物。ただし座標と字の高さは実測に合わせてある。文字認識に
// 通した領収書では、店名の字の高さが同じ範囲の他の行の 2〜3 倍（0.068 対 0.023・0.031）、
// 金額は右寄せで x=0.6〜0.7、品名は x=0.14 付近に出た。この配置を崩すと、ここで守って
// いる判定（頭でいちばん大きい行・同じ行の右端の金額・左に品名/右に金額）が意味を失う。
import { describe, expect, test } from 'vitest';
import { extractFromOcrLayout, type OcrLayout, type OcrWord } from './receipt-text-extract';

type Cell = { text: string; x: number; alternates?: string[] };
type Row = { y: number; height: number; cells: Cell[] };

// ネイティブ側の words_to_lines と同じ組み立て。ここで再現しておかないと、抽出の試験が
// ネイティブの実装を実行できる環境でしか回せなくなる。
function toLayout(rows: Row[]): OcrLayout {
  const words: OcrWord[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      words.push({
        text: cell.text,
        x: cell.x,
        y: row.y,
        width: 0.1,
        height: row.height,
        confidence: 1,
        ...(cell.alternates ? { alternates: cell.alternates } : {}),
      });
    }
  }
  const sorted = [...words].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const grouped: OcrWord[][] = [];
  for (const w of sorted) {
    const head = grouped[grouped.length - 1]?.[0];
    if (
      head &&
      Math.abs(head.y + head.height / 2 - (w.y + w.height / 2)) <=
        Math.max(head.height, w.height) / 2
    ) {
      grouped[grouped.length - 1]!.push(w);
      continue;
    }
    grouped.push([w]);
  }
  const lines = grouped
    .map((row) => {
      const ordered = [...row].sort((a, b) => a.x - b.x);
      return {
        text: ordered.map((w) => w.text).join(' '),
        words: ordered,
        x: Math.min(...ordered.map((w) => w.x)),
        y: Math.min(...ordered.map((w) => w.y)),
        width:
          Math.max(...ordered.map((w) => w.x + w.width)) - Math.min(...ordered.map((w) => w.x)),
        height:
          Math.max(...ordered.map((w) => w.y + w.height)) - Math.min(...ordered.map((w) => w.y)),
      };
    })
    .filter((l) => l.text !== '');
  return { lines, text: lines.map((l) => l.text).join('\n') };
}

// よくある小売のレシートの雛形。行の並びと座標は実測に合わせ、中身は作り物。
// 電話・レジ番号・伝票番号の 3 行を入れてあるのは、これらが品目と同じ
// 「左に文字・右に数字」の形で並ぶため。品目の判定はここを外せないと成立しない。
function receipt(over: { invoice?: Cell; items?: { y: number; cells: Cell[] }[] } = {}): OcrLayout {
  return toLayout([
    { y: 0.287, height: 0.023, cells: [{ text: 'お問合せ先/Help', x: 0.242 }] },
    { y: 0.301, height: 0.068, cells: [{ text: 'あおい薬局', x: 0.177 }] },
    { y: 0.367, height: 0.031, cells: [{ text: '【領収証】', x: 0.331 }] },
    {
      y: 0.4,
      height: 0.028,
      cells: [{ text: '登録番号', x: 0.206 }, over.invoice ?? { text: 'T1234567890123', x: 0.365 }],
    },
    { y: 0.434, height: 0.027, cells: [{ text: 'ご利用ありがとうございます', x: 0.154 }] },
    {
      y: 0.488,
      height: 0.033,
      cells: [
        { text: 'みどり町店', x: 0.117 },
        { text: '0499-99-9999', x: 0.479 },
      ],
    },
    {
      y: 0.556,
      height: 0.032,
      cells: [
        { text: '2026年05月14日（水）09:32', x: 0.109 },
        { text: 'レジ0001', x: 0.622 },
      ],
    },
    { y: 0.591, height: 0.037, cells: [{ text: '責No00000000', x: 0.104 }] },
    ...(
      over.items ?? [
        {
          y: 0.625,
          cells: [
            { text: '＊#！ミネラルウォーター', x: 0.143 },
            { text: '¥248', x: 0.69 },
          ],
        },
      ]
    ).map((r) => ({ y: r.y, height: 0.035, cells: r.cells })),
    {
      y: 0.664,
      height: 0.035,
      cells: [
        { text: '合計／', x: 0.096 },
        { text: '1点', x: 0.286 },
        { text: '¥248', x: 0.609 },
      ],
    },
    {
      y: 0.701,
      height: 0.036,
      cells: [
        { text: '（8％税対象', x: 0.096 },
        { text: '¥248）', x: 0.63 },
      ],
    },
    {
      y: 0.781,
      height: 0.036,
      cells: [
        { text: '（税合計', x: 0.083 },
        { text: '¥18）', x: 0.705 },
      ],
    },
    {
      y: 0.817,
      height: 0.032,
      cells: [
        { text: 'クレジット', x: 0.088 },
        { text: '¥248', x: 0.708 },
      ],
    },
  ]);
}

describe('extractFromOcrLayout', () => {
  test('雛形から 5 項目すべてを取り出せる', () => {
    const r = extractFromOcrLayout(receipt());
    expect(r.vendorName).toBe('あおい薬局');
    expect(r.date).toBe('2026-05-14');
    expect(r.totalAmount).toBe('248');
    expect(r.invoiceNumber).toBe('T1234567890123');
    expect(r.items).toEqual([{ description: 'ミネラルウォーター', amount: '248' }]);
  });
});

describe('店名', () => {
  // 位置の比率では決めない。近接で撮ると伝票が紙面の下寄りに写り、実測では店名が
  // 上から 30% の位置に来ていた。雛形もその配置を保っている。
  test('紙面の上から 30% にあっても拾える', () => {
    const line = receipt().lines.find((l) => l.text.includes('あおい薬局'));
    expect(line!.y).toBeGreaterThan(0.25);
  });

  // 「【領収証】」は店名より下だが大きく刷られる。除かないと字の大きさで競り勝つ。
  test('定型の見出しを店名にしない', () => {
    const layout = toLayout([
      { y: 0.02, height: 0.04, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.1, height: 0.09, cells: [{ text: '【領収証】', x: 0.1 }] },
      { y: 0.3, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('あおい商店');
  });

  // 登録番号より下は伝票の中身。品目名が大きく刷られていても店名ではない。
  test('登録番号より下は見ない', () => {
    const layout = toLayout([
      { y: 0.02, height: 0.03, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.1, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
      { y: 0.3, height: 0.08, cells: [{ text: '特売品コーヒー', x: 0.1 }] },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('あおい商店');
  });

  // 登録番号が無いレシートも多い。最初の日付か金額を境にする。
  test('登録番号が無ければ最初の日付を境にする', () => {
    const layout = toLayout([
      { y: 0.02, height: 0.03, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.1, height: 0.02, cells: [{ text: '2026年08月20日', x: 0.1 }] },
      { y: 0.3, height: 0.08, cells: [{ text: '特売品コーヒー', x: 0.1 }] },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('あおい商店');
  });

  test('頭に候補が無ければ空のまま返す', () => {
    const layout = toLayout([
      { y: 0.02, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('');
  });
});

describe('登録番号（候補から選ぶ）', () => {
  // 先頭の候補で `T` が落ちて返ることがある。しかも自信度は最大で、自信度では
  // 誤りと分からない。次の候補が正しい（実測）。
  test('先頭が誤っていても候補から正しい番号を拾う', () => {
    const layout = receipt({
      invoice: {
        text: '1234567890123',
        x: 0.365,
        alternates: ['T1234567890123', '123456789012'],
      },
    });
    expect(extractFromOcrLayout(layout).invoiceNumber).toBe('T1234567890123');
  });

  // 離れて撮ると 1 桁多く読まれることがある。実測では 3 番目の候補が正しかった。
  test('第 3 候補まで見る', () => {
    const layout = receipt({
      invoice: {
        text: 'T12345678901234',
        x: 0.365,
        alternates: ['12345678901234', 'T1234567890123'],
      },
    });
    expect(extractFromOcrLayout(layout).invoiceNumber).toBe('T1234567890123');
  });

  // 桁数が合っている物が 1 つも無ければ空。形式が合った誤りを通すと、利用者は
  // 見ても気付けない。
  test('形式に合う候補が無ければ空のまま返す', () => {
    const layout = receipt({
      invoice: { text: 'T12345678901234', x: 0.365, alternates: ['12345678901234'] },
    });
    expect(extractFromOcrLayout(layout).invoiceNumber).toBeUndefined();
  });

  // 「登録番号」と番号が別の語で返る書式。行として繋げば形式が揃う。
  test('語が割れていても行として拾う', () => {
    const layout = toLayout([
      {
        y: 0.1,
        height: 0.02,
        cells: [
          { text: '登録番号', x: 0.2 },
          { text: 'T1234567890123', x: 0.36 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).invoiceNumber).toBe('T1234567890123');
  });
});

describe('合計（同じ行の右端）', () => {
  // 素のテキストでは「行内の最後の数字」しか見られない。雛形の合計行は
  // 「合計／ | 1点 | ¥248」で、点数と金額が並んで出る。
  test('点数が並んでいても金額を取る', () => {
    expect(extractFromOcrLayout(receipt()).totalAmount).toBe('248');
  });

  // 「（税合計 ¥18）」は合計を含むが合計ではない。実測の伝票に載っている書式。
  test('税合計を合計にしない', () => {
    expect(extractFromOcrLayout(receipt()).totalAmount).not.toBe('18');
  });
});

describe('品目', () => {
  test('左に品名・右に金額の行を取り出せる', () => {
    expect(extractFromOcrLayout(receipt()).items).toEqual([
      { description: 'ミネラルウォーター', amount: '248' },
    ]);
  });

  // 電話番号・レジ番号・伝票番号を品目にすると、身に覚えの無い経費が黙って作られる。
  test('電話番号・レジ番号・伝票番号を品目にしない', () => {
    const items = extractFromOcrLayout(receipt()).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toBe('ミネラルウォーター');
  });

  // 合計より下は税の内訳や支払方法。品目ではない。
  test('合計より下は品目にしない', () => {
    expect(
      extractFromOcrLayout(receipt()).items.some((i) => i.description.includes('クレジット')),
    ).toBe(false);
  });

  // 軽減税率の印などが品名の頭に付く。雛形は `＊#！` を付けてある。
  test('品名の頭の区分記号を落とす', () => {
    expect(extractFromOcrLayout(receipt()).items[0]!.description).toBe('ミネラルウォーター');
  });

  test('複数の品目を順に取り出せる', () => {
    const layout = receipt({
      items: [
        {
          y: 0.615,
          cells: [
            { text: 'ミネラルウォーター', x: 0.143 },
            { text: '¥120', x: 0.69 },
          ],
        },
        {
          y: 0.64,
          cells: [
            { text: 'ボールペン', x: 0.143 },
            { text: '¥128', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'ミネラルウォーター', amount: '120' },
      { description: 'ボールペン', amount: '128' },
    ]);
  });
});
