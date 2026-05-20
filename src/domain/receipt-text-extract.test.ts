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
});