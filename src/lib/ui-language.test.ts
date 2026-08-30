import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUiLanguage } from './ui-language';

const { current } = vi.hoisted(() => ({ current: { locale: 'ja' } }));

// paraglide のメッセージ関数も runtime から読む。丸ごと差し替えるとそちらが動かなく
// なるので、getLocale だけ差し替える。
vi.mock(import('../paraglide/runtime'), async (importOriginal) => ({
  ...(await importOriginal()),
  getLocale: () => current.locale as 'ja' | 'zh-TW' | 'en',
}));

describe('applyUiLanguage', () => {
  afterEach(() => {
    current.locale = 'ja';
    document.documentElement.lang = 'ja';
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, '__aoikoNative');
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

  // 破棄確認はネイティブのダイアログで出る。シェル側は公開 repo のメッセージカタログを
  // 読めないので、訳した文言をここから渡す。渡し忘れると日本語のまま出る。
  it('破棄確認の文言を今の言語で橋へ渡す', () => {
    const setDiscardText = vi.fn();
    vi.stubGlobal('window', Object.assign(window, { __aoikoNative: { setDiscardText } }));

    current.locale = 'en';
    applyUiLanguage();

    expect(setDiscardText).toHaveBeenCalledTimes(1);
    const text = setDiscardText.mock.calls[0]?.[0] as Record<string, string>;
    expect(Object.keys(text).sort()).toEqual(
      ['cancel', 'closeMessage', 'closeOk', 'reloadMessage', 'reloadOk'].sort(),
    );
    for (const value of Object.values(text)) {
      expect(value).not.toBe('');
    }
    expect(text.closeOk).toBe('Discard and quit');
  });

  it('橋が無い環境では何もしない（ブラウザで開いたとき）', () => {
    expect(() => applyUiLanguage()).not.toThrow();
  });
});
