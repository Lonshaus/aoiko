import { lockedYearsAmong } from '../domain/year-lock';
import { getSetting, setSetting } from './settings';
// 申告済み年度への書き込み前の確認を 1 箇所に集約する。
//
// 申告後の補記・訂正は会計上も正当（修正申告の前提）なので硬く擋がない。書き込む前に
// 知らせるだけにして、続行するかは利用者が決める。書き込み経路は 9 箇所あるため、
// 各画面に確認用の状態と保留中の処理を持たせるのではなく、Promise を返す 1 つの関数と
// App に 1 度だけ置くダイアログにまとめる。
interface PendingFiledYearWarning {
  years: number[];
  // 影響の規模（固定資産の除却額、開業精霊の生成件数など）を伝える補足。
  detail: string | null;
  suppressible: boolean;
  resolve: (proceed: boolean) => void;
}

class FiledYearGuard {
  pending = $state<PendingFiledYearWarning | null>(null);
  // years のうち申告済みのものがあれば確認を出し、続行してよいかを返す。
  // 申告済みが無ければダイアログを出さずに true。
  async confirm(
    years: Iterable<number>,
    options?: { detail?: string; suppressible?: boolean },
  ): Promise<boolean> {
    const locked = await lockedYearsAmong(years);
    if (locked.length === 0) {
      return true;
    }
    if (options?.suppressible && (await getSetting('skipFiledYearWarning'))) {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      this.pending = {
        years: locked,
        detail: options?.detail ?? null,
        suppressible: options?.suppressible ?? false,
        resolve,
      };
    });
  }

  async resolve(proceed: boolean, dontAskAgain = false): Promise<void> {
    const p = this.pending;
    if (!p) {
      return;
    }
    this.pending = null;
    if (proceed && dontAskAgain) {
      await setSetting('skipFiledYearWarning', true);
    }
    p.resolve(proceed);
  }
}

export const filedYearGuard = new FiledYearGuard();
