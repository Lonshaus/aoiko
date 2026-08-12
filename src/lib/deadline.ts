export class DeadlineExceededError extends Error {
  constructor(public readonly ms: number) {
    super(`処理が ${ms}ms 以内に完了しませんでした`);
    this.name = 'DeadlineExceededError';
  }
}
/**
 * 時限を過ぎたら待つのをやめる。
 *
 * 主な用途はクラウド同期フォルダの読み出し。iCloud Drive 等は端末から中身を追い出した
 * ファイル（dataless）を残すことがあり、それをオフラインで読むと**例外も errno も
 * 返らないまま返ってこない**（実測 8 回中 7 回）。捕まえるものが来ないので、待つのを
 * やめる側に時限を置くしかない。
 *
 * 元の処理は止められない（ブラウザにファイル読み出しを中断する手段が無い）。時限を
 * 過ぎても裏で走り続け、回線が戻れば完了する。呼び出し側は「もう待たない」だけで、
 * 同じ処理を重ねて走らせないための管理は呼び出し側の責任。
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DeadlineExceededError(ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
