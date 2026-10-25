import { describe, expect, test } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  test('5 文字をすべて実体参照にする', () => {
    expect(escapeHtml(`<b class="a">'x' & y</b>`)).toBe(
      '&lt;b class=&quot;a&quot;&gt;&#39;x&#39; &amp; y&lt;/b&gt;',
    );
  });

  test('既存の実体参照も文字どおり表示されるよう & から崩す', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('対象外の文字はそのまま', () => {
    expect(escapeHtml('api.example.com:8080')).toBe('api.example.com:8080');
    expect(escapeHtml('送信先ホスト')).toBe('送信先ホスト');
    expect(escapeHtml('')).toBe('');
  });

  test('{@html} に差し込んでも要素を作らず、元の文字列が表示される', () => {
    const host = '<img src=x onerror="alert(1)"><b>x</b>';
    const el = document.createElement('div');
    el.innerHTML = `<strong>${escapeHtml(host)}</strong>`;
    expect(el.querySelectorAll('img, b')).toHaveLength(0);
    expect(el.textContent).toBe(host);
  });
});
