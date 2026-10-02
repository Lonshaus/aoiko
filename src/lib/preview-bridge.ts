import type { NativeBridge } from './native-bridge';

export const PREVIEW_PLATFORMS = ['browser', 'macos', 'ios', 'windows', 'android'] as const;
export type PreviewPlatform = (typeof PREVIEW_PLATFORMS)[number];
export const PREVIEW_STORAGE_KEY = 'aoiko.devDocPreviewPlatform';
// 見た目の確認用の偽物。ネイティブ専用の機能は動かさず、存在と戻り値の型だけ本物に合わせる。
export function previewBridge(
  platform: PreviewPlatform,
): (NativeBridge & Record<string, unknown>) | null {
  if (platform === 'browser') {
    return null;
  }
  const bridge: NativeBridge & Record<string, unknown> = {
    saveFile: async () => false,
    setUiLocale: async () => {},
    setDiscardText: () => {},
    isTextRecognitionAvailable: async () => true,
    recognizeText: () => Promise.reject(new Error('preview')),
    listIapProducts: async () => [
      { kind: 'tip', displayPrice: '¥999' },
      { kind: 'supporter-badge', displayPrice: '¥999' },
    ],
    purchaseIap: async () => 'cancelled',
    restoreIapPurchases: async () => [],
    backupChooseFolder: async () => null,
    backupIsReady: async () => false,
    backupWrite: () => Promise.reject(new Error('preview')),
    backupList: () => Promise.reject(new Error('preview')),
    backupRemove: () => Promise.reject(new Error('preview')),
  };
  if (platform === 'macos' || platform === 'ios') {
    bridge.appleAiAvailability = async () => 0;
    bridge.appleAiExtract = () => Promise.reject(3);
    bridge.appleAiRun = () => Promise.reject(3);
  }
  if (platform === 'android') {
    bridge.isCameraAvailable = async () => true;
  }
  return bridge;
}
