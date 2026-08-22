// 復元の結果を再読み込みをまたいで持ち越す（issue#387）。
//
// 復元は DB を丸ごと置き換えるため、画面に残った復元前の設定で上書きされないよう
// 直後に location.reload() する。ただし「何テーブル / 何行を復元したか」と
// 「実体データの無かった証憑写真の件数」は利用者が見る必要があるため、
// sessionStorage に一度だけ預けて再読み込み後に取り出す。
//
// sessionStorage を使う理由：復元したばかりの IndexedDB に書き戻すと、その書き込み自体が
// バックアップ対象になってしまう。タブを閉じれば消える一時的な通知にはこちらが合う。
const KEY = 'aoiko:restore-notice';

export interface RestoreNotice {
  tables: number;
  rows: number;
  missingBlobCount: number;
}

function isRestoreNotice(v: unknown): v is RestoreNotice {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.tables === 'number' &&
    typeof o.rows === 'number' &&
    typeof o.missingBlobCount === 'number'
  );
}

export function stashRestoreNotice(notice: RestoreNotice): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(notice));
  } catch {
    // 保存できなくても復元自体は完了している。通知が出ないだけで先へ進める。
  }
}
// 取り出したら消す。再読み込みのたびに同じ通知が出続けるのを防ぐ。
export function takeRestoreNotice(): RestoreNotice | null {
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
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRestoreNotice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
