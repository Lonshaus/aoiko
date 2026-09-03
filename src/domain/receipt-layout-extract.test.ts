// 座標付きの認識結果からの抽出。素のテキストからの抽出は receipt-text-extract.test.ts。
//
// 入力は雛形で、中身はすべて作り物。ただし座標と字の高さは実測に合わせてある。文字認識に
// 通した領収書では、店名の字の高さが同じ範囲の他の行の 2〜3 倍（0.068 対 0.023・0.031）、
// 金額は右寄せで x=0.6〜0.7、品名は x=0.14 付近に出た。この配置を崩すと、ここで守って
// いる判定（頭でいちばん大きい行・同じ行の右端の金額・左に品名/右に金額）が意味を失う。
import { describe, expect, test } from 'vitest';
import { extractFromOcrLayout, type OcrLayout, type OcrWord } from './receipt-text-extract';

type Cell = { text: string; x: number; alternates?: string[]; dy?: number; slope?: number };
type Row = { y: number; height: number; cells: Cell[] };

// ネイティブ側の words_to_lines と同じ組み立て。ここで再現しておかないと、抽出の試験が
// ネイティブの実装を実行できる環境でしか回せなくなる。
function toLayout(rows: Row[], separator = ' '): OcrLayout {
  const words: OcrWord[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      words.push({
        text: cell.text,
        x: cell.x,
        // 傾いた紙面では同じ文字線でも x が進むほど y が下がる。cell ごとにずらして再現する。
        y: row.y + (cell.dy ?? 0),
        width: 0.1,
        height: row.height,
        confidence: 1,
        ...(cell.alternates ? { alternates: cell.alternates } : {}),
        ...(cell.slope !== undefined ? { slope: cell.slope } : {}),
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
        text: ordered.map((w) => w.text).join(separator),
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

describe('紙面の傾き', () => {
  // 傾けて撮ると、同じ文字線でも左の品名と右の金額で y がずれる。ネイティブ側は
  // 水平を前提に組むので別の行になり、品名が次の行の金額と組になる（実測 5 度）。
  // 語が持つ基線の傾きで補正して組み直す。
  const SLOPE = 0.1;
  // x=0.09 と x=0.6 の差 0.51 に傾きを掛けた分だけ、右の欄が下へずれる。
  const drop = (x: number) => SLOPE * (x - 0.09);
  function skewed(over: { slope?: number } = {}): OcrLayout {
    const s = over.slope ?? SLOPE;
    const cell = (text: string, x: number): Cell => ({ text, x, dy: drop(x), slope: s });
    return toLayout([
      { y: 0.1, height: 0.03, cells: [cell('あおい商店', 0.09)] },
      { y: 0.2, height: 0.02, cells: [cell('登録番号T1234567890123', 0.09)] },
      { y: 0.3, height: 0.02, cells: [cell('あおい茶', 0.09), cell('¥138', 0.6)] },
      { y: 0.34, height: 0.02, cells: [cell('あおいパン', 0.09), cell('¥248', 0.6)] },
      { y: 0.42, height: 0.02, cells: [cell('合計', 0.09), cell('¥386', 0.6)] },
    ]);
  }

  test('傾いた紙面でも品名と金額が組になる', () => {
    const r = extractFromOcrLayout(skewed());
    expect(r.totalAmount).toBe('386');
    expect(r.items).toEqual([
      { description: 'あおい茶', amount: '138' },
      { description: 'あおいパン', amount: '248' },
    ]);
  });

  // 水平に撮っても推定はわずかに振れる。実測では 0.022 まで出た。拾うと、傾いて
  // いない紙面を勝手に傾けて組んでしまう。
  test('死区より小さい傾きは無視する', () => {
    const layout = receipt();
    const noisy: OcrLayout = {
      ...layout,
      lines: layout.lines.map((l) => ({
        ...l,
        words: l.words.map((w) => ({ ...w, slope: 0.02 })),
      })),
    };
    expect(extractFromOcrLayout(noisy).items).toEqual(extractFromOcrLayout(layout).items);
  });

  // 傾きを返さない引擎では、従来どおり水平として組む。
  test('傾きを持たない語だけなら従来と同じ結果になる', () => {
    const layout = receipt();
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'ミネラルウォーター', amount: '248' },
    ]);
  });
});

describe('語の接合符', () => {
  // 1 語 = 1 文字で返す環境では、空白で繋ぐと日本語が全部ばらける。
  // ネイティブが組んだ行と語を突き合わせて、どちらで繋がれたかを見分ける。
  test('一文字ずつ返る環境では空白を入れずに組み直す', () => {
    const layout = toLayout(
      [
        {
          y: 0.1,
          height: 0.02,
          cells: [
            { text: 'あ', x: 0.09 },
            { text: 'お', x: 0.12 },
            { text: 'い', x: 0.15 },
          ],
        },
        {
          y: 0.2,
          height: 0.02,
          cells: [
            { text: '登', x: 0.09 },
            { text: '録', x: 0.12 },
            { text: '番', x: 0.15 },
            { text: '号', x: 0.18 },
            { text: 'T1234567890123', x: 0.3 },
          ],
        },
        {
          y: 0.3,
          height: 0.02,
          cells: [
            { text: '合', x: 0.09 },
            { text: '計', x: 0.12 },
            { text: '¥386', x: 0.6 },
          ],
        },
      ],
      '',
    );
    const r = extractFromOcrLayout(layout);
    expect(r.notes).toContain('あおい');
    expect(r.notes).not.toContain('あ お い');
    expect(r.totalAmount).toBe('386');
  });
});

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

  // `T` が見出しの末尾へくっついて返る書式。単語ごとに見ても揃わない。
  test('T が見出しにくっついていても行として拾う', () => {
    const layout = toLayout([
      {
        y: 0.1,
        height: 0.02,
        cells: [
          { text: '登録番号T', x: 0.2 },
          { text: '1234567890123', x: 0.36 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).invoiceNumber).toBe('T1234567890123');
  });

  // 繋いでからの照合を見出しのある行に限らないと、`T` で終わる単語と 13 桁が
  // 隣り合っただけで番号を作ってしまう。
  test('見出しの無い行では繋いで作らない', () => {
    const layout = toLayout([
      {
        y: 0.1,
        height: 0.02,
        cells: [
          { text: '注文T', x: 0.2 },
          { text: '1234567890123', x: 0.36 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).invoiceNumber).toBeUndefined();
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

describe('合計（別行の金額を拾う）', () => {
  // 「合計／」だけの行の次に金額行が来る書式（実測）。
  test('語の行の前に金額があれば拾う', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.02, cells: [{ text: 'あおい商店', x: 0.1 }] },
      {
        y: 0.3,
        height: 0.02,
        cells: [
          { text: '2点', x: 0.09 },
          { text: '¥372', x: 0.6 },
        ],
      },
      { y: 0.4, height: 0.02, cells: [{ text: '合計／', x: 0.09 }] },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('372');
  });

  // 語の行の下に金額が来る書式もある。
  test('語の行の後ろに金額があれば拾う', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.02, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.3, height: 0.02, cells: [{ text: '合計／', x: 0.09 }] },
      {
        y: 0.4,
        height: 0.02,
        cells: [
          { text: '2点', x: 0.09 },
          { text: '¥372', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('372');
  });

  // 隣接行に通貨記号が無ければ、案内文などの地の文を金額と誤認しない。
  test('隣接行に金額の印が無ければ拾わない', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.02, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.3, height: 0.02, cells: [{ text: 'ご来店ありがとうございました', x: 0.09 }] },
      { y: 0.4, height: 0.02, cells: [{ text: '合計／', x: 0.09 }] },
      { y: 0.5, height: 0.02, cells: [{ text: 'またのご利用をお待ちしております', x: 0.09 }] },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('');
  });

  // 隣接行が除外語を含む額（お預り等）なら合計として使わない。
  test('隣接行が除外語を含むなら拾わない', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.02, cells: [{ text: 'あおい商店', x: 0.1 }] },
      {
        y: 0.3,
        height: 0.02,
        cells: [
          { text: 'お預り', x: 0.09 },
          { text: '¥1000', x: 0.6 },
        ],
      },
      { y: 0.4, height: 0.02, cells: [{ text: '合計／', x: 0.09 }] },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('');
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

  // 区分記号の間に英字が 1 文字迷い込む書式がある。
  test('記号の間の迷い込んだ英字ごと落とす', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: '※A＊あおいカレー', x: 0.143 },
            { text: '¥180', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおいカレー', amount: '180' },
    ]);
  });

  // 商品コードが品名の頭に数字の並びで付く。
  test('先頭の数字コードと記号を落とす', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: '12345＊あおいノート', x: 0.143 },
            { text: '¥150', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおいノート', amount: '150' },
    ]);
  });

  // 区分記号と頭の英字の間に空白が挟まる書式がある。
  test('英字 1 文字と記号の間に空白があっても落とす', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: 'A ＊あおいシャンプー', x: 0.143 },
            { text: '¥600', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおいシャンプー', amount: '600' },
    ]);
  });

  // 記号が付かない英字始まりの品名を、頭の英字ごと落としてはいけない。
  test('記号を伴わない英字始まりの品名は残す', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: 'AOIKOSODA', x: 0.143 },
            { text: '¥140', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'AOIKOSODA', amount: '140' },
    ]);
  });

  // 記号が付かない数字始まりの品名を、頭の数字ごと落としてはいけない。
  test('記号を伴わない数字始まりの品名は残す', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: '500mlあおい茶', x: 0.143 },
            { text: '¥130', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: '500mlあおい茶', amount: '130' },
    ]);
  });
  // 品名にスペースが入ると、文字と金額が 1 単語に同居する（実測）。
  test('品名にスペースが入り金額と同じ単語に混じっても品目を取れる', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: 'お茶', x: 0.09 },
            { text: 'ボトル ¥180', x: 0.143 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'お茶 ボトル', amount: '180' },
    ]);
  });

  test('電話番号のような単語を金額と誤認しない', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: 'お問合せ先', x: 0.09 },
            { text: '0499-99-9999', x: 0.143 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([]);
  });

  test('文字に数字が繋がった単語を金額と誤認しない', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: '伝票番号', x: 0.09 },
            { text: '店No00499', x: 0.143 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([]);
  });

  // 見出し内の単語が文字と数字を空白無しで繋いでいても、金額の行と誤認して
  // 見出しを早く閉じてはいけない。閉じると店名の探索範囲から外れて店名を失う。
  test('見出し内の文字と数字が繋がった単語があっても店名を取れる', () => {
    const layout = toLayout([
      { y: 0.3, height: 0.06, cells: [{ text: 'あおい薬局', x: 0.09 }] },
      { y: 0.35, height: 0.02, cells: [{ text: '店No00499', x: 0.09 }] },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥532', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('あおい薬局');
  });

  // 1 単語 = 1 文字で返す環境がある。単語から品名を組み立てると一文字ずつ空白が入り、
  // 「最後の単語」で見る電話番号の判定も数字の断片しか見ないので通ってしまう（実測）。
  test('1 文字ずつ返る環境でも品名と電話番号を取り違えない', () => {
    const chars = (t: string, x0: number, step = 0.02) =>
      [...t].map((c, i) => ({ text: c, x: x0 + i * step }));
    const layout = toLayout([
      { y: 0.05, height: 0.02, cells: chars('登録番号T1234567890123', 0.1) },
      { y: 0.2, height: 0.02, cells: chars('吉祥寺南町店0499ー99ー9999', 0.11) },
      { y: 0.25, height: 0.02, cells: chars('責No00891337', 0.1) },
      { y: 0.3, height: 0.02, cells: chars('＊#！ミネラルウォーター\\248', 0.14) },
      { y: 0.5, height: 0.02, cells: chars('合計/1点\\248', 0.09) },
    ]);
    // 行内は空白を挟まずに繋がる（ネイティブ側が区切りを空文字にする）。
    const joined = layout.lines.map((l) => ({ ...l, text: l.words.map((w) => w.text).join('') }));
    const r = extractFromOcrLayout({ lines: joined, text: joined.map((l) => l.text).join('\n') });
    expect(r.items).toEqual([{ description: 'ミネラルウォーター', amount: '248' }]);
  });

  // カタカナの品名は長音符で終わることが多い。区切りの判定を数字の直前の 1 文字で
  // やると、`ミネラルウォーター` の `ー` を区切りと見て品目が全部落ちる。
  test('長音符で終わる品名を落とさない', () => {
    const layout = toLayout([
      { y: 0.05, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
      {
        y: 0.2,
        height: 0.02,
        cells: [
          { text: 'コーヒー', x: 0.14 },
          { text: '¥380', x: 0.69 },
        ],
      },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥380', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'コーヒー', amount: '380' },
    ]);
  });

  // 金額は 0 で始まらない。伝票番号は 0 詰めなので、これが無いと品目に化ける。
  test('0 で始まる数字を金額にしない', () => {
    const layout = toLayout([
      { y: 0.05, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
      {
        y: 0.2,
        height: 0.02,
        cells: [
          { text: '責No', x: 0.1 },
          { text: '00891337', x: 0.6 },
        ],
      },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥248', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).items).toEqual([]);
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
  test('値引合計の行を合計と取らない', () => {
    const layout = toLayout([
      { y: 0.3, height: 0.02, cells: [{ text: 'あおい薬局', x: 0.09 }] },
      {
        y: 0.4,
        height: 0.02,
        cells: [
          { text: '（値引合計', x: 0.09 },
          { text: '-20）', x: 0.6 },
        ],
      },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥532', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('532');
  });

  test('1 単語 = 1 文字で返る環境でも合計を取れる', () => {
    const layout = toLayout(
      [
        { y: 0.3, height: 0.02, cells: [{ text: 'あおい薬局', x: 0.09 }] },
        {
          y: 0.5,
          height: 0.02,
          cells: [...'合計¥532'].map((text, i) => ({ text, x: 0.09 + i * 0.05 })),
        },
      ],
      '',
    );
    expect(extractFromOcrLayout(layout).totalAmount).toBe('532');
  });

  test('店名の行に数字が混じっても店名を取れる', () => {
    const layout = toLayout([
      { y: 0.3, height: 0.06, cells: [{ text: '3あおい薬局', x: 0.09 }] },
      { y: 0.4, height: 0.02, cells: [{ text: 'みどり町店', x: 0.09 }] },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥532', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).vendorName).toBe('3あおい薬局');
  });

  test('値引きの行は符号を保つ', () => {
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
            { text: '値引額', x: 0.143 },
            { text: '-20', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'ミネラルウォーター', amount: '120' },
      { description: '値引額', amount: '-20' },
    ]);
  });

  test('軽減税率の印は品名の末尾からも外す', () => {
    const layout = receipt({
      items: [
        {
          y: 0.625,
          cells: [
            { text: 'ミネラルウォーター', x: 0.143 },
            { text: '＊173', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'ミネラルウォーター', amount: '173' },
    ]);
  });
  // コンビニ・スーパーの実写で踏んだ。印が後ろに付く書式では品目が全数落ちていた。
  test('軽減税率の印が金額の後ろでも品目を取れる', () => {
    const layout = receipt({
      items: [
        {
          y: 0.615,
          cells: [
            { text: 'あおい茶', x: 0.143 },
            { text: '¥138軽', x: 0.69 },
          ],
        },
        {
          y: 0.64,
          cells: [
            { text: 'あおいアイスチョコミント', x: 0.143 },
            { text: '¥248軽', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおい茶', amount: '138' },
      { description: 'あおいアイスチョコミント', amount: '248' },
    ]);
  });
  // 印の書式に定めは無く、店ごとに違う（国税庁は記号を指定していない）。
  test('印が 軽減 や ※ でも品目を取れる', () => {
    const layout = receipt({
      items: [
        {
          y: 0.615,
          cells: [
            { text: 'あおい茶', x: 0.143 },
            { text: '¥138軽減', x: 0.69 },
          ],
        },
        {
          y: 0.64,
          cells: [
            { text: 'あおいパン', x: 0.143 },
            { text: '¥248※', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおい茶', amount: '138' },
      { description: 'あおいパン', amount: '248' },
    ]);
  });
  // 印が金額と離れて刷られていると、別の単語として返る。
  test('印が独立した単語でも品目を取れる', () => {
    const layout = receipt({
      items: [
        {
          y: 0.615,
          cells: [
            { text: 'あおい茶', x: 0.143 },
            { text: '¥138', x: 0.69 },
            { text: '軽', x: 0.78 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'あおい茶', amount: '138' },
    ]);
  });

  test('小計の行は品目にしない', () => {
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
            { text: '小計（税抜8%）', x: 0.143 },
            { text: '¥489', x: 0.69 },
          ],
        },
      ],
    });
    expect(extractFromOcrLayout(layout).items).toEqual([
      { description: 'ミネラルウォーター', amount: '120' },
    ]);
  });
  test('案内文を合計の行と取り違えない', () => {
    const layout = toLayout([
      { y: 0.3, height: 0.02, cells: [{ text: 'あおい薬局', x: 0.09 }] },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '合計', x: 0.09 },
          { text: '¥532', x: 0.6 },
        ],
      },
      { y: 0.6, height: 0.02, cells: [{ text: 'お買上明細は上記のとおりです。', x: 0.09 }] },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('532');
  });

  // 実写の劣化で踏んだ。合計の語が空白で割れると後備へ落ち、そこが最大額を取るため
  // クレジット控えの会社番号（桁数が多い）が合計として入っていた。
  test('クレジット控えの番号を合計にしない', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.03, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.2, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
      {
        y: 0.3,
        height: 0.02,
        cells: [
          { text: 'あおい茶', x: 0.09 },
          { text: '¥386', x: 0.6 },
        ],
      },
      {
        y: 0.4,
        height: 0.02,
        cells: [
          { text: '言十', x: 0.09 },
          { text: '¥386', x: 0.6 },
        ],
      },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '会社名', x: 0.09 },
          { text: '998877', x: 0.6 },
        ],
      },
      {
        y: 0.6,
        height: 0.02,
        cells: [
          { text: '取引日', x: 0.09 },
          { text: '55044', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('386');
  });
  // 語で決められず、金額の印がある行も無いなら空にする。埋めるより空のほうが安全。
  test('金額の印が無ければ後備は何も選ばない', () => {
    const layout = toLayout([
      { y: 0.1, height: 0.03, cells: [{ text: 'あおい商店', x: 0.1 }] },
      { y: 0.2, height: 0.02, cells: [{ text: '登録番号T1234567890123', x: 0.1 }] },
      {
        y: 0.5,
        height: 0.02,
        cells: [
          { text: '会社名', x: 0.09 },
          { text: '998877', x: 0.6 },
        ],
      },
    ]);
    expect(extractFromOcrLayout(layout).totalAmount).toBe('');
  });

  test('合計の語が読めなくても、集計欄から合計を拾う', () => {
    const layout = toLayout(
      [
        { y: 0.3, height: 0.02, cells: [{ text: 'あおい薬局', x: 0.09 }] },
        {
          y: 0.4,
          height: 0.02,
          cells: [
            { text: '小計(税抜8%)', x: 0.09 },
            { text: '¥489', x: 0.6 },
          ],
        },
        {
          y: 0.45,
          height: 0.02,
          cells: [
            { text: '税率8%対象', x: 0.09 },
            { text: '¥528', x: 0.6 },
          ],
        },
        {
          y: 0.5,
          height: 0.02,
          cells: [
            { text: '言十', x: 0.09 },
            { text: '¥532', x: 0.6 },
          ],
        },
        {
          y: 0.55,
          height: 0.02,
          cells: [
            { text: 'お預り', x: 0.09 },
            { text: '¥540', x: 0.6 },
          ],
        },
      ],
      '',
    );
    expect(extractFromOcrLayout(layout).totalAmount).toBe('532');
  });
});
