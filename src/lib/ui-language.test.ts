import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUiLanguage } from './ui-language';

const { current } = vi.hoisted(() => ({ current: { locale: 'ja' } }));

vi.mock('../paraglide/runtime', () => ({
  getLocale: () => current.locale,
}));

describe('applyUiLanguage', () => {
  afterEach(() => {
    current.locale = 'ja';
    document.documentElement.lang = 'ja';
  });

  it('解決済みロケールを <html lang> へ入れる', () => {
    current.locale = 'zh-TW';
    applyUiLanguage();
    expect(document.documentElement.lang).toBe('zh-TW');
  });

  it('ja へ戻したときも書き戻す（初期値のまま放置しない）', () => {
    document.documentElement.lang = 'en';
    applyUiLanguage();
    expect(document.documentElement.lang).toBe('ja');
  });
});
