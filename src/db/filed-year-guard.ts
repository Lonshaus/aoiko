import Dexie, {
  type DBCoreTable,
  type DBCoreTransaction,
  type ObservabilitySet,
  type Transaction,
} from 'dexie';
import { countsTowardTotals } from '../domain/journal';
import type { JournalEntry, ReportSnapshot } from './types';
// 申告済み年度への書き込みを止められたときに投げる。年度を持たせるのは、呼出側が
// 「どの年度で止まったか」を利用者へ出せるようにするため。
//
// ドメイン層ではなくここに置く。db.ts がこのモジュールを読み込むため、ドメイン層側に置くと
// `db → guard → domain → db` の循環参照になる。domain/year-lock.ts が再エクスポートする。
export class FiledYearError extends Error {
  readonly years: number[];
  constructor(years: number[]) {
    super(
      `${years.join('・')} 年は申告済みのためロックされています。修正する場合は年度ロックを解除してください。`,
    );
    this.name = 'FiledYearError';
    this.years = years;
  }
}
// 申告済み年度への書き込みを、通り道そのもので止める。
//
// 入口ごとに門を置く形（#412）は、その関数を通る限りしか守れない。画面から直接
// db.journalEntries.add を呼ぶ経路や、これから増える入口には効かず、足し忘れても
// 気付けない。dbcore middleware なら書き込みは全部ここを通る。
//
// 申告済みかは、取引の範囲に reportSnapshots があればその取引の中で読む。確認の後に別のタブが
// 申告しても、IndexedDB は範囲の重なる取引を順に走らせるので取り逃がさない。範囲に無い取引
// （暗黙の取引など）では読めないので、メモリ上のキャッシュで判定する。
//
// 画面の確認で通すのは、利用者がダイアログで見た年度だけ。
const filedYears = new Set<number>();
// 「この取引は画面の確認を通っている」の印。値は通してよい年度の集合、復元だけは全部通す true。
// グローバルなフラグにすると、確認したのとは別の書き込みが同時に走ったときに巻き込んで通して
// しまう。取引に付ければ巻き込まない。
const ALLOW_MARK = '__aoikoAllowFiledYear';
const NO_YEARS: ReadonlySet<number> = new Set();

interface MarkedTransaction {
  [ALLOW_MARK]?: true | Set<number>;
}

function markedTransaction(): (typeof Dexie.currentTransaction & MarkedTransaction) | null {
  return Dexie.currentTransaction as (typeof Dexie.currentTransaction & MarkedTransaction) | null;
}
/**
 * 今の取引で、申告済みの years へ書いてよいと印を付ける。取引の中から呼ぶ。同じ取引で
 * 何度か呼ぶと年度を足し合わせる。
 *
 * 渡すのは、画面の確認で利用者に見せた年度（確認ダイアログの戻り値）だけ。ドメイン層側の門
 * （assertYearsWritable）を通っただけでは足りない——門は取引の外で判定するので、書き込み自体には
 * 印が残らない。
 */
export function allowFiledYearWriteInThisTransaction(years: readonly number[]): void {
  const trans = markedTransaction();
  if (trans === null || trans[ALLOW_MARK] === true) {
    return;
  }
  const allowed = trans[ALLOW_MARK] ?? new Set<number>();
  for (const year of years) {
    allowed.add(year);
  }
  trans[ALLOW_MARK] = allowed;
}
/**
 * 今の取引では申告済みの年度すべてへ書いてよいと印を付ける。復元（表の置換）だけが使う。
 */
export function allowAllFiledYearWritesInThisTransaction(): void {
  const trans = markedTransaction();
  if (trans !== null) {
    trans[ALLOW_MARK] = true;
  }
}

function allowedFiledYears(): true | ReadonlySet<number> {
  return markedTransaction()?.[ALLOW_MARK] ?? NO_YEARS;
}

export function filedYearsSnapshot(): number[] {
  return [...filedYears].sort((a, b) => a - b);
}
// reportSnapshots の 1 行から「その年度が申告済みか」を読む。pl の filed だけが
// 年度ロックの根拠（snapshots.ts の isYearLocked と同じ条件）。
function marksYearFiled(row: ReportSnapshot): boolean {
  return row.type === 'pl' && row.status === 'filed';
}
// 1 つの最上位の取引で reportSnapshots へ書いた pl の年度。
interface SnapshotWrites {
  filed: Set<number>;
  unfiling: Set<number>;
  // この取引がキャッシュへ足した年度（足す前には無かったもの）。巻き戻しで外す。
  added: Set<number>;
  // 確定後に DB から読み直す印。削除では消えた行の中身が分からず、取引内の確認が読めなかった
  // ときも解除してよいか決められないため、読み直しで正す。
  needsRefresh: boolean;
}

function newSnapshotWrites(): SnapshotWrites {
  return { filed: new Set(), unfiling: new Set(), added: new Set(), needsRefresh: false };
}
// 申告はすぐキャッシュへ足し、解除の候補になる年度は返すだけにする。解除を確定前に反映すると、取引が
// 巻き戻ったときに申告済みのまま書ける隙間が空く。足すほうは、巻き戻っても余計に止める
// だけで済み、巻き戻しの通知で外せる。
function recordSnapshotWrites(
  writes: SnapshotWrites,
  values: readonly unknown[],
  failures: Readonly<Record<number, Error>>,
): Set<number> {
  const candidates = new Set<number>();
  values.forEach((value, i) => {
    const row = value as ReportSnapshot | null;
    if (Object.hasOwn(failures, i) || row?.type !== 'pl') {
      return;
    }
    if (marksYearFiled(row)) {
      writes.filed.add(row.year);
      if (!filedYears.has(row.year)) {
        filedYears.add(row.year);
        writes.added.add(row.year);
      }
    } else {
      candidates.add(row.year);
    }
  });
  return candidates;
}
// 同じ年度の別の行がまだ filed なら、その年度は申告済みのまま。同じ取引の中で読むのは、
// この取引で書いた行を含めた確定時の状態で判断するため。読めなければ null。
async function hasFiledRowInTransaction(
  table: DBCoreTable,
  trans: DBCoreTransaction,
  year: number,
): Promise<boolean | null> {
  try {
    const index = table.schema.getIndexByKeyPath(['year', 'type', 'status']);
    if (index === undefined) {
      return null;
    }
    const key = [year, 'pl', 'filed'];
    // type: 1 は DBCoreRangeType.Equal。const enum は isolatedModules では参照できない。
    const res = await table.query({
      trans,
      values: false,
      limit: 1,
      query: { index, range: { type: 1, lower: key, upper: key } },
    });
    return res.result.length > 0;
  } catch {
    return null;
  }
}

async function confirmUnfiling(
  table: DBCoreTable,
  trans: DBCoreTransaction,
  writes: SnapshotWrites,
  candidates: ReadonlySet<number>,
): Promise<void> {
  for (const year of candidates) {
    if (writes.filed.has(year)) {
      continue;
    }
    const stillFiled = await hasFiledRowInTransaction(table, trans, year);
    if (stillFiled === null) {
      writes.needsRefresh = true;
    } else if (!stillFiled) {
      writes.unfiling.add(year);
    }
  }
}
// 同じ取引の中で申告と解除が両方あれば申告を優先する（書いた順には依らない）。
function applyUnfiling(writes: SnapshotWrites): boolean {
  let unfiled = false;
  for (const year of writes.unfiling) {
    if (!writes.filed.has(year)) {
      filedYears.delete(year);
      unfiled = true;
    }
  }
  return unfiled;
}

let refreshing: Promise<void> = Promise.resolve();

function trackRefresh(refresh: Promise<void>): Promise<void> {
  const settled = refresh.catch(() => {});
  refreshing = Promise.all([refreshing, settled]).then(() => {});
  return refresh;
}
/**
 * 進行中の読み直しがすべて終わるのを待つ。止めるかどうかの判定には使わない。
 */
export function filedYearsSettled(): Promise<void> {
  return refreshing;
}

function refreshInBackground(db: Dexie): void {
  try {
    void trackRefresh(Dexie.ignoreTransaction(() => refreshFiledYears(db))).catch(() => {});
  } catch {
    // 読み直せなくても、次に開いたときに読み直す。
  }
}

function commitSnapshotWrites(db: Dexie, writes: SnapshotWrites): void {
  if (!applyUnfiling(writes) && !writes.needsRefresh) {
    return;
  }
  refreshInBackground(db);
}

function rollbackSnapshotWrites(writes: SnapshotWrites): void {
  for (const year of writes.added) {
    filedYears.delete(year);
  }
  writes.added.clear();
}
const writesByTransaction = new WeakMap<object, SnapshotWrites>();
// 子の取引の abort は発火せず、complete は子の処理を抜けた時点で発火するので、最上位の
// 取引の通知だけを使う。通知の処理は false を返さない（Dexie はそれで先に登録された処理を飛ばす）。
function writesForDexieTransaction(db: Dexie, trans: Transaction): SnapshotWrites {
  let root = trans;
  while (root.parent) {
    root = root.parent;
  }
  const known = writesByTransaction.get(root);
  if (known !== undefined) {
    return known;
  }
  const writes = newSnapshotWrites();
  writesByTransaction.set(root, writes);
  root.on('complete', () => {
    commitSnapshotWrites(db, writes);
  });
  root.on('error', () => {
    rollbackSnapshotWrites(writes);
  });
  root.on('abort', () => {
    rollbackSnapshotWrites(writes);
  });
  return writes;
}
// 素の IDBTransaction の error は、取引を止めない要求の失敗でも届くので使わない。本当に
// 失敗した取引には必ず abort が届く。
function writesForNativeTransaction(db: Dexie, trans: EventTarget): SnapshotWrites {
  const known = writesByTransaction.get(trans);
  if (known !== undefined) {
    return known;
  }
  const writes = newSnapshotWrites();
  writesByTransaction.set(trans, writes);
  trans.addEventListener('complete', () => {
    commitSnapshotWrites(db, writes);
  });
  trans.addEventListener('abort', () => {
    rollbackSnapshotWrites(writes);
  });
  return writes;
}
// 書き込みの入口で、まだ await する前に今の取引を掴む。
function snapshotWritesFor(db: Dexie, nativeTrans: unknown): SnapshotWrites | null {
  const trans = Dexie.currentTransaction;
  if (trans !== null) {
    return writesForDexieTransaction(db, trans);
  }
  if (
    typeof nativeTrans === 'object' &&
    nativeTrans !== null &&
    typeof (nativeTrans as EventTarget).addEventListener === 'function'
  ) {
    return writesForNativeTransaction(db, nativeTrans as EventTarget);
  }
  return null;
}

async function refreshFiledYears(db: Dexie): Promise<void> {
  const rows = (await db
    .table<ReportSnapshot>('reportSnapshots')
    .where('type')
    .equals('pl')
    .toArray()) as ReportSnapshot[];
  filedYears.clear();
  for (const row of rows) {
    if (marksYearFiled(row)) {
      filedYears.add(row.year);
    }
  }
}

const guardedDbs = new Set<Dexie>();
/**
 * どこかの接続（別のタブを含む）が reportSnapshots を書いて確定したら、キャッシュを読み直す。
 * 範囲に reportSnapshots を含まない取引の書き込みは、キャッシュで判定するしかないため。
 */
export function refreshFiledYearsOnStorageMutated(parts: ObservabilitySet): void {
  const keys = Object.keys(parts);
  for (const db of guardedDbs) {
    const prefix = `idb://${db.name}/reportSnapshots/`;
    if (keys.some((key) => key === 'all' || key.startsWith(prefix))) {
      refreshInBackground(db);
    }
  }
}
// 書き込む行のうち、集計に入り year が数値のものの年度。
function countedYears(values: readonly unknown[]): Set<number> {
  const years = new Set<number>();
  for (const value of values) {
    const entry = value as Partial<JournalEntry> | null;
    const year = entry?.year;
    if (typeof year !== 'number') {
      continue;
    }
    // 集計に入らない仕訳は、申告済み年度へ入っても数字を動かさない。訂正仕訳は日付が
    // 今日になるため、今年が申告済みなら「去年の仕訳を訂正する」だけでここへ来る。
    // 止めると訂正そのものができなくなる（countsTowardTotals と同じ判定に揃える）。
    if (
      entry?.status !== undefined &&
      !countsTowardTotals({
        status: entry.status,
        ...(entry.originalEntryId === undefined ? {} : { originalEntryId: entry.originalEntryId }),
      })
    ) {
      continue;
    }
    years.add(year);
  }
  return years;
}

async function blockedYears(
  db: Dexie,
  snapshots: DBCoreTable,
  trans: DBCoreTransaction,
  values: readonly unknown[],
  allowed: ReadonlySet<number>,
): Promise<number[]> {
  const hit = new Set<number>();
  let stale = false;
  for (const year of countedYears(values)) {
    if (allowed.has(year)) {
      continue;
    }
    // 整数でない年度は範囲を作れず取引の中では読めないので、キャッシュで判定する。
    const filed = Number.isInteger(year)
      ? await hasFiledRowInTransaction(snapshots, trans, year)
      : null;
    if (filed === null) {
      if (filedYears.has(year)) {
        hit.add(year);
      }
    } else if (filed) {
      hit.add(year);
      filedYears.add(year);
    } else if (filedYears.has(year)) {
      stale = true;
    }
  }
  if (stale) {
    refreshInBackground(db);
  }
  return [...hit].sort((a, b) => a - b);
}
/**
 * 書き込みの通り道に門を差し込む。db.open() より前に呼ぶ。
 *
 * journalEntries：申告済み年度への add/put を止める。取引の範囲に reportSnapshots があれば
 * 取引の中の申告記録で、無ければキャッシュで判定する。通すのは印の付いた年度だけ。delete は
 * 見ない——訂正は反対仕訳で行う決まりで、確定仕訳を物理削除する経路はそもそも無い（#332）。
 * 全消し（clear）は復元だけが行い、そこは全部通す印を付ける。
 *
 * reportSnapshots：申告の記録そのものなので、書き込みを拾ってメモリ上のキャッシュを更新する。これで
 * 「申告した直後の書き込み」が古いキャッシュで素通りすることを防ぐ。申告はすぐ、解除は取引の確定後に
 * 反映し、取引が巻き戻ったら申告で足した年度を外す。解除はその年度に filed の pl が残っていない
 * ときだけ。
 */
export function installFiledYearGuard(db: Dexie): void {
  guardedDbs.add(db);
  Dexie.on('storagemutated', refreshFiledYearsOnStorageMutated);
  db.use({
    stack: 'dbcore',
    name: 'aoikoFiledYearGuard',
    create(downlevel) {
      return {
        ...downlevel,
        table(name: string) {
          const table = downlevel.table(name);
          if (name !== 'journalEntries' && name !== 'reportSnapshots') {
            return table;
          }
          return {
            ...table,
            mutate: async (req: Parameters<typeof table.mutate>[0]) => {
              const values = 'values' in req ? ((req.values ?? []) as unknown[]) : [];
              if (name === 'journalEntries') {
                // 印は待つより前に読む。素の await を挟むと今の取引を辿れなくなる。
                const allowed = allowedFiledYears();
                if (allowed === true) {
                  return table.mutate(req);
                }
                // 下の層（hooks）も今の取引を見るので、Dexie の Promise で繋いで取引の文脈を保つ。
                return Dexie.Promise.resolve(
                  blockedYears(db, downlevel.table('reportSnapshots'), req.trans, values, allowed),
                ).then((blocked) => {
                  if (blocked.length > 0) {
                    throw new FiledYearError(blocked);
                  }
                  return table.mutate(req);
                });
              }
              const writes = snapshotWritesFor(db, req.trans);
              // 取引を掴めなかったときは確定を待てないので、すぐ反映する。
              const target = writes ?? newSnapshotWrites();
              if (req.type === 'delete' || req.type === 'deleteRange') {
                target.needsRefresh = true;
              }
              const result = await table.mutate(req);
              // 申告は確認の読み取りより先に足す。読み取りを待つ間も止めておくため。
              const candidates = recordSnapshotWrites(target, values, result.failures);
              await confirmUnfiling(table, req.trans, target, candidates);
              if (writes === null) {
                commitSnapshotWrites(db, target);
              }
              return result;
            },
          };
        },
      };
    },
  });
  // 開くたびに読み直す。ready は最初の取引が完了する前に走るので、門が空のキャッシュで
  // 判定してしまう隙間は空かない。
  //
  // 第 3 引数の sticky が要る。Dexie の ready は既定で一度発火したら購読が外れるため、
  // 付けないと db.delete() 後の開き直しで読み直されず、前のデータベースの年度が
  // メモリ上のキャッシュに残骸として残る（復元後や、テストのように張り直す経路で必ず起きる）。
  db.on(
    'ready',
    async () => {
      await trackRefresh(refreshFiledYears(db));
    },
    true,
  );
}
