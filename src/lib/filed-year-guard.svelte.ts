import { lockedYearsAmong } from '../domain/year-lock';
import { getSetting, setSetting } from './settings';
// 申告済み年度への書き込み前の確認を 1 箇所に集約する。
//
// 申告後の補記・訂正は会計上も正当（修正申告の前提）なので強制的には止めない。書き込む前に
// 知らせるだけにして、続行するかは利用者が決める。書き込み経路は 9 箇所あるため、
// 各画面に確認用の状態と保留中の処理を持たせるのではなく、Promise を返す 1 つの関数と
// App に 1 度だけ置くダイアログにまとめる。
interface PendingFiledYearWarning {
  years: number[];
  // 影響の規模（固定資産の除却額、開業設定の生成件数など）を伝える補足。
  detail: string | null;
  suppressible: boolean;
  resolve: (proceed: boolean) => void;
}

class FiledYearGuard {
  pending = $state<PendingFiledYearWarning | null>(null);
  // years のうち申告済みのものがあれば確認を出す。続行なら確認した時点で申告済みだった年度
  // （無ければ空配列）、取消なら null を返す。戻り値は書き込みの門へ渡す、通してよい年度。
  async confirm(
    years: Iterable<number>,
    options?: { detail?: string; suppressible?: boolean },
  ): Promise<readonly number[] | null> {
    const locked = await lockedYearsAmong(years);
    if (locked.length === 0) {
      return locked;
    }
    if (options?.suppressible && (await getSetting('skipFiledYearWarning'))) {
      return locked;
    }
    return new Promise<readonly number[] | null>((resolve) => {
      this.pending = {
        years: locked,
        detail: options?.detail ?? null,
        suppressible: options?.suppressible ?? false,
        resolve: (proceed) => {
          resolve(proceed ? locked : null);
        },
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
