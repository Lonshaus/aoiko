import { isPlatform, stripBuildOnly, type Platform } from './build-only';

export const DOC_PREVIEW_STORAGE_KEY = 'aoiko.devDocPreviewPlatform';
// localStorage が読めない環境（プライベートウィンドウ等）や不正値では fallback に倒す。
export function readPreviewPlatform(fallback: Platform): Platform {
  try {
    const value = localStorage.getItem(DOC_PREVIEW_STORAGE_KEY);
    return value !== null && isPlatform(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePreviewPlatform(platform: Platform): void {
  try {
    localStorage.setItem(DOC_PREVIEW_STORAGE_KEY, platform);
  } catch {
    // 書けない環境でも画面は動かし続ける（次回起動は fallback になるだけ）
  }
}

export function foldModules(
  modules: Record<string, string>,
  platform: Platform,
): Record<string, string> {
  const folded: Record<string, string> = {};
  for (const [path, content] of Object.entries(modules)) {
    folded[path] = stripBuildOnly(content, platform, path);
  }
  return folded;
}
// build では __DOC_PREVIEW__ が false に畳まれ、この分岐ごと産物から落ちる。
export function previewModules(modules: Record<string, string>): Record<string, string> {
  if (!__DOC_PREVIEW__) {
    return modules;
  }
  const fallback = isPlatform(__DOC_PLATFORM__) ? __DOC_PLATFORM__ : 'browser';
  return foldModules(modules, readPreviewPlatform(fallback));
}
