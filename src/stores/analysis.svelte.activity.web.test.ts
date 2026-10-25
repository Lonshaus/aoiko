import { afterEach, describe, expect, test, vi } from 'vitest';
import { analysis } from './analysis.svelte';
// このプロジェクトは __NATIVE__ = false（web のビルド設定）。
afterEach(() => {
  if (analysis.job !== null) {
    analysis.finish(analysis.job, 'cancelled');
  }
  vi.unstubAllGlobals();
});

describe('web では作業中宣言を OS へ伝えない', () => {
  test('橋渡しが注入されていても、入口を呼ばない', async () => {
    const begin = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    vi.stubGlobal('window', {
      ...window,
      __aoikoNative: { analysisActivityBegin: begin, analysisActivityEnd: end },
    });
    analysis.finish(analysis.begin('receipt')!, 'done');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(begin).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
});
