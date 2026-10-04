import { PREVIEW_PLATFORMS, PREVIEW_STORAGE_KEY, previewBridge } from './preview-bridge';
import type { PreviewPlatform } from './preview-bridge';
// dev server 専用。他のモジュールが __NATIVE__ を読む前に差し替えるため、main.ts の先頭で読み込む。
if (__DOC_PREVIEW__) {
  const g = globalThis as unknown as Record<string, unknown>;
  const isPreviewPlatform = (v: unknown): v is PreviewPlatform =>
    typeof v === 'string' && (PREVIEW_PLATFORMS as readonly string[]).includes(v);
  if (!g['__aoikoNative']) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PREVIEW_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const platform: PreviewPlatform = isPreviewPlatform(stored)
      ? stored
      : isPreviewPlatform(__DOC_PLATFORM__)
        ? __DOC_PLATFORM__
        : 'browser';
    g['__NATIVE__'] = platform !== 'browser';
    g['__aoikoPreviewPlatform'] = platform;
    // 実ブリッジが無いときだけ、他の参照元もプレビュー先の環境を向くようにする。
    g['__DOC_PLATFORM__'] = platform;
    const bridge = previewBridge(platform);
    if (bridge) {
      g['__aoikoNative'] = bridge;
      navigator.storage.persisted = async () => true;
      navigator.storage.persist = async () => true;
    }
  }
}
