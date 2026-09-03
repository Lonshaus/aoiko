import { describe, expect, test } from 'vitest';
import { extractFromOcrText } from './receipt-text-extract';

describe('extractFromOcrText', () => {
  test('適格請求書登録番号（T+13）を抽出', () => {
    const r = extractFromOcrText('株式会社サンプル\nT1234567890123\n合計 ¥1,500');
    expect(r.invoiceNumber).toBe('T1234567890123');
  });

  test('登録番号が無ければ invoiceNumber は undefined', () => {
    const r = extractFromOcrText('店名\n合計 1500');
    expect(r.invoiceNumber).toBeUndefined();
  });

  // OS 内蔵の文字認識が先頭の T を落として返す（実測）。空のままだと帳簿では
  // 適格請求書でない扱いになり、仕入税額控除に効く。
  test('T が落ちた登録番号を、同じ行に手掛かりがあれば補う', () => {
    const r = extractFromOcrText('株式会社サンプル\n登録番号 1234567890123\n合計 ¥1,500');
    expect(r.invoiceNumber).toBe('T1234567890123');
  });

  test('インボイスの語でも補う', () => {
    const r = extractFromOcrText('インボイス番号 9876543210987\n合計 1000');
    expect(r.invoiceNumber).toBe('T9876543210987');
  });

  test('手掛かりの無い 13 桁は登録番号にしない', () => {
    const r = extractFromOcrText('レシート番号 1234567890123\n合計 1000');
    expect(r.invoiceNumber).toBeUndefined();
  });

  test('13 桁ちょうどでなければ補わない', () => {
    const r = extractFromOcrText('登録番号 123456789012345\n合計 1000');
    expect(r.invoiceNumber).toBeUndefined();
  });

  // 実測で踏んだ形。同じ領収書を離れて撮ると 1 桁多く返ってきた。先頭 13 桁を
  // 切り出すと形式は合ってしまい、別の番号でも利用者は誤りに気付けない。
  test('T の後ろが 13 桁より長ければ採用しない', () => {
    const r = extractFromOcrText('登録番号 T12345678901234\n合計 159');
    expect(r.invoiceNumber).toBeUndefined();
  });

  test('T の後ろが 13 桁より短ければ採用しない', () => {
    const r = extractFromOcrText('登録番号 T718030101695\n合計 159');
    expect(r.invoiceNumber).toBeUndefined();
  });

  test('T の前に数字が続いていても採用しない', () => {
    const r = extractFromOcrText('伝票 9T1234567890123\n合計 1000');
    expect(r.invoiceNumber).toBeUndefined();
  });

  test('T 付きが読めていれば補正は働かない', () => {
    const r = extractFromOcrText('登録番号 T1234567890123\n別番号 9999999999999\n合計 1000');
    expect(r.invoiceNumber).toBe('T1234567890123');
  });

  // 実際のレシートで踏んだ形：店の電話が「0499 年 99 月 99 日」として先に命中し、
  // 後ろにある本物の日付まで届かなかった。番号は作り物に置き換えてある。
  test('電話番号を日付と取り違えて諦めない', () => {
    const r = extractFromOcrText('みどり町店 0499-99-9999\n2026年05月14日（水）09:32\n合計 ¥248');
    expect(r.date).toBe('2026-05-14');
  });

  test('19xx/20xx 以外の 4 桁は年として採らない', () => {
    const r = extractFromOcrText('注文 0499-99-9999\n合計 1000');
    expect(r.date).toBe('');
  });

  test('西暦日付（YYYY/MM/DD）を抽出', () => {
    const r = extractFromOcrText('2026/05/20\n合計 1000');
    expect(r.date).toBe('2026-05-20');
  });

  test('和暦（令和N年M月D日）を西暦に変換', () => {
    const r = extractFromOcrText('令和8年5月20日\n合計 1000');
    expect(r.date).toBe('2026-05-20');
  });

  test('和暦「令和元年」を 2019 に変換', () => {
    const r = extractFromOcrText('令和元年12月3日\n合計 500');
    expect(r.date).toBe('2019-12-03');
  });

  test('YYYY年M月D日 形式（区切り混在）', () => {
    const r = extractFromOcrText('2026年5月1日 14:23\n合計 800');
    expect(r.date).toBe('2026-05-01');
  });

  test('日付が無ければ date は空文字（today に推定しない）', () => {
    const r = extractFromOcrText('合計 1000');
    expect(r.date).toBe('');
  });

  test('合計行から金額を抽出（カンマ・¥ 対応）', () => {
    const r = extractFromOcrText('店名\n小計 ￥1,200\n合計 ￥1,320');
    expect(r.totalAmount).toBe('1320');
  });

  test('小計のみで合計が無い場合は totalAmount 空（推測しない）', () => {
    const r = extractFromOcrText('小計 1,200\nお預り 2,000\nお釣り 800');
    expect(r.totalAmount).toBe('');
  });

  test('お預り/お釣り/釣銭/現金/ポイント/還元は合計と誤認しない', () => {
    const text =
      '小計 1,200\n' +
      'お預り 2,000\n' +
      'お釣り 800\n' +
      '釣銭 100\n' +
      '現金 2,000\n' +
      'ポイント還元 50';
    const r = extractFromOcrText(text);
    expect(r.totalAmount).toBe('');
  });

  test('「合計」キーワード行に複数金額があれば最後を採用', () => {
    const r = extractFromOcrText('合計 (税込) 1,200 円');
    expect(r.totalAmount).toBe('1200');
  });

  test('「お買上げ」「総額」「ご請求」もキーワードとして認識', () => {
    expect(extractFromOcrText('お買上げ 980 円').totalAmount).toBe('980');
    expect(extractFromOcrText('総額 ¥3,300').totalAmount).toBe('3300');
    expect(extractFromOcrText('ご請求金額 5500円').totalAmount).toBe('5500');
  });

  test('vendorName と items は弱推定しない（必ず空）', () => {
    const r = extractFromOcrText('カフェサンプル\n2026/05/20\n合計 500');
    expect(r.vendorName).toBe('');
    expect(r.items).toEqual([]);
  });

  test('OCR 全文を notes にプレフィル', () => {
    const text = '店名\n2026/05/20\n合計 500';
    const r = extractFromOcrText(text);
    expect(r.notes).toBe(text);
  });

  test('空入力でも throw しない（全欄空）', () => {
    const r = extractFromOcrText('');
    expect(r.date).toBe('');
    expect(r.totalAmount).toBe('');
    expect(r.vendorName).toBe('');
    expect(r.items).toEqual([]);
    expect(r.invoiceNumber).toBeUndefined();
  });

  test('解読不能なノイズでも throw しない', () => {
    const r = extractFromOcrText('@#$%^&*()_\nXXX YYY ZZZ');
    expect(r.totalAmount).toBe('');
    expect(r.date).toBe('');
  });

  test('合計が複数行存在する場合は最大値（税込 > 税抜想定）', () => {
    const r = extractFromOcrText('合計（税抜）1,000\n合計（税込）1,100');
    expect(r.totalAmount).toBe('1100');
  });

  test('無効日付（13月など）は採用しない', () => {
    const r = extractFromOcrText('2026/13/45\n合計 500');
    expect(r.date).toBe('');
  });

  // 実測の OCR 出力そのまま（tesseract-wasm + jpn）。`,` が `.` に化け、
  // 文字間に空白が入る。以前はこれで `2` と `200` に割れ、合計が 200 になっていた。
  test('桁区切りが . に化けても合計を取り違えない', () => {
    const r = extractFromOcrText(
      'あお いこ 商店\nT1234567890123\n2026 年 08 月 13 日\n小計 2.000 円\n消費 税 200 円\n合計 2.200 円\nお 釣り 800 円',
    );
    expect(r.totalAmount).toBe('2200');
    expect(r.date).toBe('2026-08-13');
    expect(r.invoiceNumber).toBe('T1234567890123');
  });

  // 同じ画像でも出方が揺れる。これも実測の OCR 出力そのまま（区切りが `.,` の 2 文字）。
  test('桁区切りが複数文字に化けても合計を取り違えない', () => {
    const r = extractFromOcrText('小計 2.000 円\n消費 税 200 円\n\n合計 2.,200 円');
    expect(r.totalAmount).toBe('2200');
  });

  test('3 桁ちょうどでない . は桁区切りとみなさない', () => {
    expect(extractFromOcrText('合計 2.20 円').totalAmount).toBe('20');
  });

  test('除外語の 1 文字誤読（税→柷）でも除外され、誤った値を合計にしない', () => {
    const r = extractFromOcrText('柷合計 ¥9999\n合計 ¥500');
    expect(r.totalAmount).toBe('500');
  });

  test('濁点が分離した誤読（ポ→ホ。）でも除外語として効く', () => {
    const r = extractFromOcrText('ホ。イント還元 200円\n合計 700円');
    expect(r.totalAmount).toBe('700');
  });

  test('2 文字の除外語は誤読を許さない（小計とは別語として扱う）', () => {
    expect(extractFromOcrText('小計 ¥100').totalAmount).toBe('');
    expect(extractFromOcrText('合計 ¥500').totalAmount).toBe('500');
  });

  test('通常の品名は誤って除外されない', () => {
    const r = extractFromOcrText('からあげ弁当 480円\n合計 480円');
    expect(r.totalAmount).toBe('480');
  });
});

// ある環境 の文字認識に通したあと、行まとめを経た形の雛形。中身は作り物だが、
// 単語ごとに矩形が返るため空白を挟むと一文字ずつばらける点と、通貨記号が半角の
// `\\` で返り `円` が一度も出ない点は実測どおりに写してある。
describe('OS 内蔵の文字認識で一文字ずつ返る環境の形', () => {
  const sample = [
    'あおい薬局',
    '【領収証】',
    '登録番号T1234567890123',
    'ご利用ありがとうございます',
    'みどり町店0499ー99ー9999',
    '2026年05月14日(水)0932い。0001',
    '責N。00000000',
    '*#!ミネラルウォーター\\248',
    '合計/1点\\248',
    '(8%税対象\\248)',
    '(8%税*18)',
    '(税合計*18)',
    'クレジット\\248',
  ].join('\n');

  test('登録番号・日付・合計をそのまま取り出せる', () => {
    const r = extractFromOcrText(sample);
    expect(r.invoiceNumber).toBe('T1234567890123');
    expect(r.date).toBe('2026-05-14');
    expect(r.totalAmount).toBe('248');
  });

  // 店の電話が日付より前に出る。年を 19xx / 20xx に限っていないと
  // `0499ー99ー9999` が日付として先に当たる。
  test('店の電話番号を日付と取り違えない', () => {
    expect(extractFromOcrText(sample).date).toBe('2026-05-14');
  });
  // 金額の末尾の 0 が大文字の O として返る（実測の `¥460` → `f46O`）。数字が途中で
  // 切れて一桁少なくなる。
  test('金額末尾の O を 0 として読む', () => {
    expect(extractFromOcrText('あおい商店\n合計 f46O').totalAmount).toBe('460');
  });
  // 数字に挟まれた位置も直す。
  test('数字に挟まれた O も 0 として読む', () => {
    expect(extractFromOcrText('あおい商店\n合計 ¥1O0').totalAmount).toBe('100');
  });
  // O の前が数字でなければ触らない。伝票番号やレジ番号を金額に化けさせない。
  test('見出しの O は直さない', () => {
    expect(extractFromOcrText('あおい商店\n責No.999\n合計 ¥386').totalAmount).toBe('386');
  });
  // 劣化した画像では字間に空白が入る（実測の `合 計 ¥460`）。潰さずに語で見ると
  // 一致が外れる。
  test('合計の字間に空白が入っても取れる', () => {
    expect(extractFromOcrText('あおい商店\n合 計 ¥386').totalAmount).toBe('386');
  });
  // 除外語も同じ扱いにしないと、字間に空白が入った集計行が合計をすり抜ける。
  test('字間に空白が入った税合計を合計にしない', () => {
    expect(extractFromOcrText('あおい商店\n（税 合 計 ¥35）').totalAmount).toBe('');
  });
});
