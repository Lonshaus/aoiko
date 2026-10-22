import { router } from '../router.svelte';
import { ANALYSIS_ROUTE, isAnalysisKind } from '../stores/analysis.svelte';
import { nativeBridge } from './native-bridge';
// 通知のクリックはサービスワーカーからこのメッセージで届く。内容は信用せず、
// 既知の種別のときだけ、表から引いた経路へ移る。
export function openAnalysisRouteFromMessage(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    return;
  }
  const { type, kind } = data as { type?: unknown; kind?: unknown };
  if (type !== 'aoiko-open-route' || !isAnalysisKind(kind)) {
    return;
  }
  router.goto(ANALYSIS_ROUTE[kind]);
}
// ネイティブの通知のクリックは {kind} の合図で届く。ページ上のスクリプトも同じ名前の
// イベントを出せるので、これも信用せず、既知の種別のときだけ表から引いた経路へ移る。
export function openAnalysisRouteFromPayload(data: unknown): void {
  if (typeof data !== 'object' || data === null) {
    return;
  }
  const { kind } = data as { kind?: unknown };
  if (!isAnalysisKind(kind)) {
    return;
  }
  router.goto(ANALYSIS_ROUTE[kind]);
}

export function installAnalysisNotifyListener(): void {
  if (__NATIVE__) {
    // 購読に失敗しても通知は出る。画面へ移れないだけなので、起動は止めない。
    void nativeBridge()
      ?.onAnalysisOpen?.(openAnalysisRouteFromPayload)
      .catch(() => {});
    return;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.addEventListener('message', (event) => {
    openAnalysisRouteFromMessage(event.data);
  });
}
