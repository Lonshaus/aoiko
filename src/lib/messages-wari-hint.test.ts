// 2割／3割特例の基礎調整欄の説明文言が、三語とも「未だ相殺していない」旨と
// 「消費税（国税）部分のみ」旨の2つの限定を含むことを確認する。
import { describe, expect, test } from 'vitest';
import ja from '../../messages/ja.json';
import en from '../../messages/en.json';
import zhTW from '../../messages/zh-TW.json';

describe('messages/*.json の reports_wari_sales_return_tax_hint', () => {
  test('日本語は「相殺」（未だ相殺していない）と「国税」の2つの限定を含む', () => {
    const text = ja.reports_wari_sales_return_tax_hint;
    expect(text).toContain('相殺');
    expect(text).toContain('国税');
  });

  test('英語は「offset」と「national」の2つの限定を含む', () => {
    const text = en.reports_wari_sales_return_tax_hint;
    expect(text.toLowerCase()).toContain('offset');
    expect(text.toLowerCase()).toContain('national');
  });

  test('正體中文は「沖銷」と「國稅」の2つの限定を含む', () => {
    const text = zhTW.reports_wari_sales_return_tax_hint;
    expect(text).toContain('沖銷');
    expect(text).toContain('國稅');
  });
});
