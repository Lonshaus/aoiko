import { afterEach, describe, expect, test, vi } from 'vitest';
import { runnerConfig } from './native-runner-client';
// web のビルド（__NATIVE__ = false）では、橋渡しがあっても runner を使わない。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web のビルド', () => {
  test('iOS 形の橋渡しがあっても従来の経路のまま', () => {
    vi.stubGlobal('window', {
      ...window,
      __aoikoNative: {
        runAnalysis: async () => {},
        takeAnalysis: async () => ({}),
        cancelAnalysis: async () => {},
      },
    });
    expect(
      runnerConfig({ engine: 'openai-compatible', model: 'm', apiKey: '', baseUrl: 'http://x' }),
    ).toBeNull();
    expect(runnerConfig({ engine: 'gemini', model: 'g', apiKey: 'k' })).toBeNull();
  });
});
