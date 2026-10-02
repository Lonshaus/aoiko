import { describe, expect, it } from 'vitest';
import { PLATFORMS } from './build-only';
import { DOC_PREVIEW_STORAGE_KEY } from './doc-preview';
import { PREVIEW_PLATFORMS, PREVIEW_STORAGE_KEY, previewBridge } from './preview-bridge';

describe('preview-bridge', () => {
  it('build-only と doc-preview の定義と一致する', () => {
    expect([...PREVIEW_PLATFORMS]).toEqual([...PLATFORMS]);
    expect(PREVIEW_STORAGE_KEY).toBe(DOC_PREVIEW_STORAGE_KEY);
  });

  it('browser は橋渡しを持たない', () => {
    expect(previewBridge('browser')).toBeNull();
  });

  it('macos / ios は appleAi を持ち availability は 0', async () => {
    for (const p of ['macos', 'ios'] as const) {
      const b = previewBridge(p);
      expect(b?.appleAiExtract).toBeTypeOf('function');
      expect(b?.appleAiRun).toBeTypeOf('function');
      expect(await b?.appleAiAvailability?.()).toBe(0);
    }
  });

  it('windows は appleAi を持たない', () => {
    const b = previewBridge('windows');
    expect(b).not.toBeNull();
    expect(b?.appleAiAvailability).toBeUndefined();
    expect(b?.appleAiExtract).toBeUndefined();
    expect(b?.appleAiRun).toBeUndefined();
  });

  it('android は appleAi を持たず、カメラが使える', async () => {
    const b = previewBridge('android');
    expect(b).not.toBeNull();
    expect(b?.appleAiAvailability).toBeUndefined();
    expect(b?.appleAiExtract).toBeUndefined();
    expect(b?.appleAiRun).toBeUndefined();
    expect(await (b?.isCameraAvailable as () => Promise<boolean>)()).toBe(true);
  });

  it('android 以外のネイティブは isCameraAvailable を持たない', () => {
    for (const p of ['macos', 'ios', 'windows'] as const) {
      expect(previewBridge(p)?.isCameraAvailable).toBeUndefined();
    }
  });

  it('原生側の共通関数が揃い、価格は ¥999 の仮値', async () => {
    for (const p of ['macos', 'ios', 'windows', 'android'] as const) {
      const b = previewBridge(p);
      expect(b?.saveFile).toBeTypeOf('function');
      expect(b?.backupChooseFolder).toBeTypeOf('function');
      expect(await b?.saveFile?.(new Uint8Array(), 'a')).toBe(false);
      expect(await b?.isTextRecognitionAvailable?.()).toBe(true);
      expect(await b?.purchaseIap?.('tip')).toBe('cancelled');
      expect(await b?.restoreIapPurchases?.()).toEqual([]);
      expect(await (b?.backupChooseFolder as () => Promise<unknown>)()).toBeNull();
      expect((await b?.listIapProducts?.())?.map((x) => x.displayPrice)).toEqual(['¥999', '¥999']);
      await expect(b?.recognizeText?.('')).rejects.toBeDefined();
    }
  });
});
