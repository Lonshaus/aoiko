import { describe, expect, test } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  test('5 つの文字を実体参照にする', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('タグは文字として表示される形になる', () => {
    expect(escapeHtml('<b id="inj">x</b>')).toBe('&lt;b id=&quot;inj&quot;&gt;x&lt;/b&gt;');
  });

  test('既にある実体参照も二重に変換する', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  test('通常の文字列は変えない', () => {
    expect(escapeHtml('api.example.com:8080')).toBe('api.example.com:8080');
    expect(escapeHtml('東京都 1-2-3')).toBe('東京都 1-2-3');
    expect(escapeHtml('')).toBe('');
  });
});
