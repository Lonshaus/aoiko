import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppleAiAdapter } from './apple-ai-adapter';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppleAiAdapter', () => {
  test('external=false・destinationHost 空（端末外に出ない）', () => {
    const adapter = new AppleAiAdapter();
    expect(adapter.external).toBe(false);
    expect(adapter.destinationHost).toBe('');
  });

  test('プロンプト経由は拒否する（指示を上書きできる口を作らない）', async () => {
    const adapter = new AppleAiAdapter();
    await expect(adapter.generateJson('何か')).rejects.toThrow();
  });

  test('runDataTask：task を数値コードへ変換し、data を JSON 文字列で渡す', async () => {
    const appleAiRun = vi.fn(async () => '{"classifications":[]}');
    vi.stubGlobal('window', { __aoikoNative: { appleAiRun } });
    const adapter = new AppleAiAdapter();
    const result = await adapter.runDataTask('classify', { transactions: [] });
    expect(appleAiRun).toHaveBeenCalledWith(1, '{"transactions":[]}');
    expect(result).toEqual({ classifications: [] });
  });

  test('runDataTask：order は task=2', async () => {
    const appleAiRun = vi.fn(async () => '{"totalAmount":"1000","items":[]}');
    vi.stubGlobal('window', { __aoikoNative: { appleAiRun } });
    const adapter = new AppleAiAdapter();
    await adapter.runDataTask('order', { text: '注文内容' });
    expect(appleAiRun).toHaveBeenCalledWith(2, '{"text":"注文内容"}');
  });

  test('橋渡しが無ければ拒否する', async () => {
    vi.stubGlobal('window', {});
    const adapter = new AppleAiAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow();
  });

  test('数値コードの拒否はコード別の文言になる', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiRun: vi.fn(async () => {
          throw 1;
        }),
      },
    });
    const adapter = new AppleAiAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow(/情報量が多すぎて/);
  });

  // 権限不足・未知コマンドは tauri が文字列で reject する。モデルの不調（数値コード）と
  // 混ぜると、配線ミスがモデルの限界に見えてしまう。
  test('文字列での拒否（権限不足・未知コマンド）は配線ミスと分かる文言になる', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: {
        appleAiRun: vi.fn(async () => {
          throw 'plugin:aoiko-native.apple_ai_run not allowed';
        }),
      },
    });
    const adapter = new AppleAiAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow(/呼び出せませんでした/);
  });

  test('ネイティブから JSON でない文字列が返ったら拒否する', async () => {
    vi.stubGlobal('window', {
      __aoikoNative: { appleAiRun: async () => 'not json' },
    });
    const adapter = new AppleAiAdapter();
    await expect(adapter.runDataTask('classify', {})).rejects.toThrow();
  });
});
