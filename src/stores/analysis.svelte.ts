import { registerUnloadCheck } from '../router.svelte';

export type AnalysisKind = 'receipt' | 'order' | 'classify';
export type AnalysisOutcome = 'done' | 'failed' | 'cancelled';

export interface AnalysisJob {
  readonly id: number;
  readonly kind: AnalysisKind;
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly cancelling: boolean;
}

export interface AnalysisNotice {
  readonly id: number;
  readonly kind: AnalysisKind;
  readonly outcome: 'done' | 'failed';
}

export const ANALYSIS_ROUTE: Record<AnalysisKind, string> = {
  receipt: '/receipt',
  order: '/order-import',
  classify: '/import',
};

const TOAST_MS = 8000;
// 3 画面で解析の実行権を 1 つだけ共有する。端末内の AI は行程全体で 1 件しか生成できず、
// 2 件目を許すと busy で落ちるため、キューにはせず開始を断る。
class AnalysisStore {
  // 取消しても、中止できない経路は元の Promise が終わるまで実行権を持ち続ける。
  job = $state.raw<AnalysisJob | null>(null);
  viewing = $state<AnalysisKind | null>(null);
  unseen = $state<Partial<Record<AnalysisKind, 'done' | 'failed'>>>({});
  notices = $state<AnalysisNotice[]>([]);
  #seq = 0;

  get busy(): boolean {
    return this.job !== null;
  }

  get menuIndicator(): 'failed' | 'done' | 'running' | null {
    const states = Object.values(this.unseen);
    if (states.includes('failed')) {
      return 'failed';
    }
    if (states.includes('done')) {
      return 'done';
    }
    return this.job !== null ? 'running' : null;
  }

  isRunning(kind: AnalysisKind): boolean {
    return this.job?.kind === kind;
  }

  isCancelling(kind: AnalysisKind): boolean {
    return this.job?.kind === kind && this.job.cancelling;
  }

  isBusyWithOther(kind: AnalysisKind): boolean {
    return this.job !== null && this.job.kind !== kind;
  }

  begin(kind: AnalysisKind): AnalysisJob | null {
    if (this.job !== null) {
      return null;
    }
    this.#seq += 1;
    const job: AnalysisJob = {
      id: this.#seq,
      kind,
      startedAt: Date.now(),
      controller: new AbortController(),
      cancelling: false,
    };
    this.job = job;
    return job;
  }
  // 結果を捨てる判定は signal.aborted で行う（job は不変なので cancelling の複製は参照しない）。
  isCancelled(job: AnalysisJob): boolean {
    return job.controller.signal.aborted;
  }

  cancel(): void {
    const job = this.job;
    if (job === null || job.cancelling) {
      return;
    }
    this.job = { ...job, cancelling: true };
    job.controller.abort();
  }

  finish(job: AnalysisJob, outcome: AnalysisOutcome): void {
    if (this.job?.id === job.id) {
      this.job = null;
    }
    if (outcome === 'cancelled' || this.viewing === job.kind) {
      return;
    }
    this.unseen = { ...this.unseen, [job.kind]: outcome };
    this.#seq += 1;
    const notice: AnalysisNotice = { id: this.#seq, kind: job.kind, outcome };
    this.notices = [...this.notices, notice];
    setTimeout(() => this.dismissNotice(notice.id), TOAST_MS);
  }
  // 画面が表示されている間は完了通知を出さない。戻ってきたら待ち状態も解く。
  enter(kind: AnalysisKind): void {
    this.viewing = kind;
    this.acknowledge(kind);
  }

  leave(kind: AnalysisKind): void {
    if (this.viewing === kind) {
      this.viewing = null;
    }
  }

  acknowledge(kind: AnalysisKind): void {
    if (this.unseen[kind] !== undefined) {
      const { [kind]: _removed, ...rest } = this.unseen;
      this.unseen = rest;
    }
    this.notices = this.notices.filter((n) => n.kind !== kind);
  }

  dismissNotice(id: number): void {
    this.notices = this.notices.filter((n) => n.id !== id);
  }
}

export const analysis = new AnalysisStore();
registerUnloadCheck(() => analysis.busy);
