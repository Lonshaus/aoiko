// ホームの通知から設定画面へ飛ぶとき、どの欄へ送るかを渡す（issue#509）。
// 経路は restore-notice と同じ形にしてある。router は path しか見ておらず、
// hash を足すと画面の突き合わせが壊れるため、URL ではなく脇から渡す。
const KEY = 'aoiko:settings-target';

export type SettingsTarget = 'backup';

const TARGETS: SettingsTarget[] = ['backup'];

function isSettingsTarget(v: string): v is SettingsTarget {
  return (TARGETS as string[]).includes(v);
}

export function stashSettingsTarget(target: SettingsTarget): void {
  try {
    sessionStorage.setItem(KEY, target);
  } catch {
    // 渡せなくても遷移そのものは成立する。先頭に着くだけで先へ進める。
  }
}
// 取り出したら消す。設定画面を開くたびに同じ場所へ送られるのを防ぐ。
export function takeSettingsTarget(): SettingsTarget | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  return isSettingsTarget(raw) ? raw : null;
}
