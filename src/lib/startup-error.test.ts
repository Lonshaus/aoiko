import { beforeEach, describe, expect, it } from 'vitest';
import { renderStartupError } from './startup-error';

describe('renderStartupError', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('日本語・英語・繁体中国語の見出しを #app に表示する', () => {
    renderStartupError(new Error('boom'));
    const text = document.getElementById('app')?.textContent ?? '';
    expect(text).toContain('aoiko を起動できませんでした');
    expect(text).toContain('aoiko failed to start');
    expect(text).toContain('aoiko 無法啟動');
    expect(text).toContain('boom');
  });

  it('詳細の < > & を取り除く', () => {
    renderStartupError(new Error('a<b>c&d'));
    const text = document.getElementById('app')?.textContent ?? '';
    expect(text).toContain('abcd');
    expect(document.getElementById('app')?.querySelector('b')).toBeNull();
  });

  it('#app が無ければ何もしない', () => {
    document.body.innerHTML = '';
    expect(() => renderStartupError(new Error('x'))).not.toThrow();
  });
});
