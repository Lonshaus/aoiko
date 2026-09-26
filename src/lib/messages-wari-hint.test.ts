// D3-F6：2割／3割特例の基数調整欄の説明文言が、三語とも「未だ相殺していない」旨と
// 「消費税（国税）部分のみ」旨の2つの限定を含むことを確認する。
import { describe, expect, test } from 'vitest';
import ja from '../../messages/ja.json';
import en from '../../messages/en.json';
import zhTW from '../../messages/zh-TW.json';

describe('D3-F6：messages/*.json の reports_wari_sales_return_tax_hint', () => {
  test('日本語は「相殺」（未だ相殺していない）と「国税」の2つの限定を含む', () => {
    const text = ja.reports_wari_sales_return_tax_hint;
    expect(text).toContain('相殺');
    expect(text).toContain('国税');
  });

  test('English contains both "offset" and "national" limitations', () => {
    const text = en.reports_wari_sales_return_tax_hint;
    expect(text.toLowerCase()).toContain('offset');
    expect(text.toLowerCase()).toContain('national');
  });

  test('正體中文包含「沖銷」與「國稅」兩項限定', () => {
    const text = zhTW.reports_wari_sales_return_tax_hint;
    expect(text).toContain('沖銷');
    expect(text).toContain('國稅');
  });
});
