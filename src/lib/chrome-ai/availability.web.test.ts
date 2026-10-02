import { afterEach, describe, expect, test, vi } from 'vitest';
import { chromeAiAvailability, createChromeAiSession, languageModel } from './availability';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chromeAiAvailability', () => {
  test('LanguageModel が無ければ unavailable', async () => {
    await expect(chromeAiAvailability()).resolves.toBe('unavailable');
  });

  test('壊れた形（メソッド欠け）なら unavailable', async () => {
    vi.stubGlobal('LanguageModel', { availability: async () => 'available' });
    await expect(chromeAiAvailability()).resolves.toBe('unavailable');
    expect(languageModel()).toBeUndefined();
  });

  test('availability() が例外を投げても unavailable', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => {
        throw new Error('boom');
      },
      create: async () => {
        throw new Error('unused');
      },
    });
    await expect(chromeAiAvailability()).resolves.toBe('unavailable');
  });

  for (const state of ['available', 'downloadable', 'downloading'] as const) {
    test(`${state} をそのまま返す`, async () => {
      vi.stubGlobal('LanguageModel', {
        availability: async () => state,
        create: async () => {
          throw new Error('unused');
        },
      });
      await expect(chromeAiAvailability()).resolves.toBe(state);
    });
  }

  test('未知の状態文字列は unavailable に倒す', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'no-such-state',
      create: async () => {
        throw new Error('unused');
      },
    });
    await expect(chromeAiAvailability()).resolves.toBe('unavailable');
  });

  // 画像入力を問わない実装は、収據の経路（画像を渡す OCR）が成り立たないので外す。
  test('画像入力込みで問う', async () => {
    const availability = vi.fn(async (_options?: unknown) => 'available');
    vi.stubGlobal('LanguageModel', {
      availability,
      create: async () => {
        throw new Error('unused');
      },
    });
    await chromeAiAvailability();
    expect(availability).toHaveBeenCalledTimes(1);
    const options = availability.mock.calls[0]?.[0] as { expectedInputs?: { type: string }[] };
    expect(options.expectedInputs).toContainEqual({ type: 'image' });
  });
});

describe('createChromeAiSession', () => {
  test('LanguageModel が無ければ投げる', async () => {
    await expect(createChromeAiSession()).rejects.toThrow(/unavailable/);
  });

  test('生成時も画像入力込みで問う', async () => {
    const create = vi.fn(async (_options?: unknown) => ({
      contextWindow: 100,
      measureContextUsage: async () => 0,
      prompt: async () => '{}',
      destroy: () => {},
    }));
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create,
    });
    await createChromeAiSession();
    const options = create.mock.calls[0]?.[0] as { expectedInputs?: { type: string }[] };
    expect(options.expectedInputs).toContainEqual({ type: 'image' });
  });

  test('available なら create() を1回呼ぶ', async () => {
    const create = vi.fn(async () => ({
      contextWindow: 100,
      measureContextUsage: async () => 0,
      prompt: async () => '{}',
      destroy: () => {},
    }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });
    await createChromeAiSession();
    expect(create).toHaveBeenCalledTimes(1);
  });
  // available 以外で create() を呼ぶとモデルの取得が始まりうる。
  for (const state of ['downloadable', 'downloading', 'unavailable'] as const) {
    test(`${state} なら create() を呼ばずに投げる`, async () => {
      const create = vi.fn(async () => {
        throw new Error('must not be called');
      });
      vi.stubGlobal('LanguageModel', { availability: async () => state, create });
      await expect(createChromeAiSession()).rejects.toThrow(
        'chrome-ai is unavailable in this browser',
      );
      expect(create).not.toHaveBeenCalled();
    });
  }

  test('availability() が例外を投げたら create() を呼ばずに投げる', async () => {
    const create = vi.fn(async () => {
      throw new Error('must not be called');
    });
    vi.stubGlobal('LanguageModel', {
      availability: async () => {
        throw new Error('boom');
      },
      create,
    });
    await expect(createChromeAiSession()).rejects.toThrow(
      'chrome-ai is unavailable in this browser',
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('class として公開されている環境', () => {
  test('availability を返す', async () => {
    class FakeLanguageModel {
      static availability(): Promise<string> {
        return Promise.resolve('available');
      }
      static create(): Promise<unknown> {
        return Promise.resolve({});
      }
    }
    vi.stubGlobal('LanguageModel', FakeLanguageModel);
    await expect(chromeAiAvailability()).resolves.toBe('available');
  });
});
