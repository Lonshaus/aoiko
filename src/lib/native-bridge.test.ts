import { afterEach, describe, expect, test, vi } from 'vitest';
import { nativeBridge } from './native-bridge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nativeBridge', () => {
  test('注入されていなければ null（ブラウザで開いた場合）', () => {
    expect(nativeBridge()).toBeNull();
  });

  test('注入されていればそのオブジェクトを返す', () => {
    const api = { saveFile: async () => true };
    vi.stubGlobal('window', { ...window, __aoikoNative: api });
    expect(nativeBridge()).toBe(api);
  });
  // 能力の有無は呼出側が関数ごとに判定する。橋渡しがあること＝その機能があること、
  // ではない（シェル側の実装は段階的に増えるため）。
  test('一部の能力しか無い橋渡しもそのまま返す', () => {
    const api = { setUiLocale: async () => {} };
    vi.stubGlobal('window', { ...window, __aoikoNative: api });
    const bridge = nativeBridge();
    expect(bridge).toBe(api);
    expect(typeof bridge?.saveFile).toBe('undefined');
  });
});
