import { m } from '../paraglide/messages';
import { getLocale } from '../paraglide/runtime';
import type { AnalysisKind } from '../stores/analysis.svelte';
import { nativeBridge } from './native-bridge';

export type AnalysisNotifyPermission = NotificationPermission | 'unsupported';

const SCREEN_NAME: Record<AnalysisKind, () => string> = {
  receipt: m.nav_receipt,
  order: m.nav_order_import,
  classify: m.nav_import,
};
function webPermission(): AnalysisNotifyPermission {
  if (
    typeof Notification === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return 'unsupported';
  }
  return Notification.permission;
}
// 知らない値は使えない扱いにする。許可を勝手に読み替えない。
function toPermission(status: unknown): AnalysisNotifyPermission {
  return status === 'default' || status === 'denied' || status === 'granted'
    ? status
    : 'unsupported';
}
// ネイティブ側の入口が無い環境（通知の仕組みが無い環境）と、問い合わせの失敗は、どちらも使えない扱い。
async function nativePermission(request: boolean): Promise<AnalysisNotifyPermission> {
  const bridge = nativeBridge();
  const ask = request ? bridge?.requestNotification : bridge?.notificationStatus;
  if (bridge === null || typeof ask !== 'function') {
    return 'unsupported';
  }
  try {
    return toPermission(await ask.call(bridge));
  } catch {
    return 'unsupported';
  }
}
// 通知を出せる環境かと現在の許可状態。ネイティブ側は OS に問い合わせるので非同期。
export async function analysisNotifyPermission(): Promise<AnalysisNotifyPermission> {
  if (__NATIVE__) {
    return nativePermission(false);
  }
  return webPermission();
}
// 許可の要求は利用者の操作の中で呼んだときしか受け付けられない。呼び出し側は操作ハンドラの先頭から直接呼ぶこと。
// ブラウザでは、最初の await より前に requestPermission を呼ぶ必要がある（操作の有効期間が切れる）ので、
// 非同期の問い合わせ関数は通さず、同期の webPermission で見る。
export async function requestAnalysisNotifyPermission(): Promise<AnalysisNotifyPermission> {
  if (__NATIVE__) {
    return nativePermission(true);
  }
  const current = webPermission();
  if (current !== 'default') {
    return current;
  }
  return Notification.requestPermission();
}

function nativeLocale(): 'ja' | 'en' | 'zh-TW' {
  const locale = getLocale();
  return locale === 'en' || locale === 'zh-TW' ? locale : 'ja';
}
// 通知に載せるのは画面の名前と結果だけ。金額・取引先・エラーの中身は、ロック画面に出るので渡さない。
export async function notifyAnalysisDone(
  kind: AnalysisKind,
  outcome: 'done' | 'failed',
): Promise<void> {
  if (__NATIVE__) {
    // 渡すのは種別・結果・言語の列挙値だけ。文面はネイティブ側が固定表から引く。
    if ((await analysisNotifyPermission()) === 'granted') {
      await nativeBridge()?.notifyAnalysis?.(kind, outcome, nativeLocale());
    }
    return;
  }
  if (webPermission() !== 'granted') {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const name = SCREEN_NAME[kind]();
  await registration.showNotification(m.app_name(), {
    body:
      outcome === 'done' ? m.analysis_notify_done({ name }) : m.analysis_notify_failed({ name }),
    tag: `aoiko-analysis-${kind}`,
    data: { kind },
  });
}
