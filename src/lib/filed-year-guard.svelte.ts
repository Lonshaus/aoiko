import { lockedYearsAmong } from '../domain/year-lock';
import { getSetting, setSetting } from './settings';
// 申告済み年度への書き込み前の確認。申告後の補記・訂正は会計上正当（修正申告の前提）なので
// 硬く擋がず、知らせて続行の可否を利用者に委ねる。
interface PendingFiledYearWarning {
  years: number[];
  // 影響の規模（固定資産の除却額、開業精霊の生成件数など）を伝える補足。
  detail: string | null;
  suppressible: boolean;
  resolve: (proceed: boolean) => void;
}

class FiledYearGuard {
  pending = $state<PendingFiledYearWarning | null>(null);
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
