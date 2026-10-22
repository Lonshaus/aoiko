import { analysisNotifyPermission, notifyAnalysisDone } from '../lib/analysis-notify';
import { newId } from '../lib/id';
import { nativeBridge } from '../lib/native-bridge';
import { getSetting } from '../lib/settings';
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

export function isAnalysisKind(value: unknown): value is AnalysisKind {
  return typeof value === 'string' && Object.hasOwn(ANALYSIS_ROUTE, value);
}

const TOAST_MS = 8000;
// ロック名は他のタブと重ならないようタブごとに変える。解析の連番はタブごとに 0 から始まる。
const TAB_ID = newId();
// 解析中は Web Lock を保持し続ける。ブラウザの省エネ機能は、ロックを持つタブを凍結しない。
// 取得は待たない。解析の開始をロックの状況に左右させないため。終わった後に取得できても何も保持しない。
function holdWebLock(name: string): () => void {
  const locks: LockManager | null | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) {
    return () => {};
  }
  const request = new AbortController();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks
    .request(name, { signal: request.signal }, () => (request.signal.aborted ? undefined : held))
    .catch(() => {});
  return () => {
    request.abort();
    release();
  };
}
// 解析中は OS に作業中であることを伝える（アプリが裏に回っても止められにくくする）。
// 終了は開始の応答が返ってから送る。先に終了が着くと、後から着いた開始が残ってしまう。
// 失敗しても解析自体は進められるので、結果は捨てる。
function holdNativeActivity(job: string): () => void {
  const bridge = __NATIVE__ ? nativeBridge() : null;
  if (typeof bridge?.analysisActivityBegin !== 'function') {
    return () => {};
  }
  const begun = Promise.resolve()
    .then(() => bridge.analysisActivityBegin?.(job))
    .catch(() => {});
  return () => {
    void begun.then(() => bridge.analysisActivityEnd?.(job)).catch(() => {});
  };
}

function userIsAway(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus();
}
// 許可は呼ぶ時点の実際の状態で見る（設定がオンでも、ブラウザ側で取り消されていれば出さない）。
async function notifyIfEnabled(kind: AnalysisKind, outcome: 'done' | 'failed'): Promise<void> {
  if ((await analysisNotifyPermission()) !== 'granted') {
    return;
  }
  if ((await getSetting('analysisNotifyEnabled')) !== true) {
    return;
  }
  await notifyAnalysisDone(kind, outcome);
}
// 3 画面で解析の実行権を 1 つだけ共有する。端末内の AI は行程全体で 1 件しか生成できず、
// 2 件目を許すと busy で落ちるため、キューにはせず開始を断る。
class AnalysisStore {
  // 取消しても、中止できない経路は元の Promise が終わるまで実行権を持ち続ける。
  job = $state.raw<AnalysisJob | null>(null);
  viewing = $state<AnalysisKind | null>(null);
  unseen = $state<Partial<Record<AnalysisKind, 'done' | 'failed'>>>({});
  notices = $state<AnalysisNotice[]>([]);
  #seq = 0;
  #releaseLocks = new Map<number, () => void>();

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
    const name = `${TAB_ID}-${job.id}`;
    const releaseLock = holdWebLock(`aoiko-analysis-${name}`);
    const endActivity = holdNativeActivity(name);
    this.#releaseLocks.set(job.id, () => {
      releaseLock();
      endActivity();
    });
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
    this.#releaseLock(job.id);
  }

  #releaseLock(id: number): void {
    this.#releaseLocks.get(id)?.();
    this.#releaseLocks.delete(id);
  }

  finish(job: AnalysisJob, outcome: AnalysisOutcome): void {
    this.#releaseLock(job.id);
    if (this.job?.id === job.id) {
      this.job = null;
    }
    // 表示中の画面かどうかとは別に、離れていれば OS の通知を出す。
    if (outcome !== 'cancelled' && userIsAway()) {
      notifyIfEnabled(job.kind, outcome).catch(() => {});
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
