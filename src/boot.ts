import { renderStartupError } from './lib/startup-error';
// アプリ本体のモジュール評価が main.ts 自身の try より前に落ちうる（ストレージ遮断下の Dexie の BroadcastChannel 等）ため、ここで受ける。
try {
  await import('./main');
} catch (e) {
  renderStartupError(e);
}
