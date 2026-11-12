import { checkStoredData, type DataCheckResult } from '../domain/data-check';
import { describeStorageError } from '../lib/storage-error';

export type DataCheckStatus = 'idle' | 'running' | 'done' | 'error';
// 保存データの点検の状態。ホームの通知と設定画面が同じ結果を見る。
export class DataCheckStore {
  status = $state<DataCheckStatus>('idle');
  result = $state<DataCheckResult | null>(null);
  error = $state<string | null>(null);

  private readonly check: () => Promise<DataCheckResult>;
  private started = false;
  private runId = 0;
  private current: Promise<void> | null = null;

  constructor(check: () => Promise<DataCheckResult> = checkStoredData) {
    this.check = check;
  }
  // 起動ごとに 1 回だけ点検する。2 回目以降は走っている点検（または済んだ点検）を返す。
  ensureStarted(): Promise<void> {
    if (!this.started) {
      this.started = true;
      return this.rerun();
    }
    return this.current ?? Promise.resolve();
  }
  // 例外は外へ出さない。点検中にデータベースが閉じられても、未処理の rejection を残さない。
  rerun(): Promise<void> {
    const id = ++this.runId;
    this.status = 'running';
    this.error = null;
    this.current = this.execute(id);
    return this.current;
  }

  private async execute(id: number): Promise<void> {
    try {
      const result = await this.check();
      if (id === this.runId) {
        this.result = result;
        this.status = 'done';
      }
    } catch (e) {
      if (id === this.runId) {
        this.result = null;
        this.error = describe(e);
        this.status = 'error';
      }
    }
  }
}

function describe(e: unknown): string {
  try {
    return describeStorageError(e);
  } catch {
    return '';
  }
}

export const dataCheck = new DataCheckStore();
