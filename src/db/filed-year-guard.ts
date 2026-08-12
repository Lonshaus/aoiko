import Dexie from 'dexie';
import { countsTowardTotals } from '../domain/journal';
import type { JournalEntry, ReportSnapshot } from './types';
// 申告済み年度への書き込みを止められたときに投げる。年度を持たせるのは、呼出側が
// 「どの年度で止まったか」を利用者へ出せるようにするため。
//
// domain ではなくここに置く。db.ts がこの module を読み込むため、domain 側に置くと
// db → guard → domain → db の輪ができる。domain/year-lock.ts が再輸出する。
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
// 申告済み年度の集合は多くても数個なので記憶に載せる。書き込みのたびに DB を引かずに
// 済み、書込トランザクションの中から reportSnapshots を読む必要も無い。
const filedYears = new Set<number>();
// 「この取引は画面の確認を通っている」の印。全域の旗にすると、確認したのとは別の
// 書き込みが同時に走ったときに巻き込んで通してしまう。取引に付ければ巻き込まない。
const ALLOW_MARK = '__aoikoAllowFiledYear';

interface MarkedTransaction {
  [ALLOW_MARK]?: boolean;
}
/**
 * 今の取引を「申告済み年度へ書いてよい」と印を付ける。取引の中から呼ぶ。
 *
 * 呼ぶのは、画面で確認を取った経路だけ。domain 側の門（assertYearsWritable）を
 * 通っただけでは足りない——門は取引の外で判定するので、書き込み自体には印が残らない。
 */
export function allowFiledYearWriteInThisTransaction(): void {
  const trans = Dexie.currentTransaction as
    (typeof Dexie.currentTransaction & MarkedTransaction) | null;
  if (trans !== null) {
    trans[ALLOW_MARK] = true;
  }
}

function isAllowed(): boolean {
  const trans = Dexie.currentTransaction as
    (typeof Dexie.currentTransaction & MarkedTransaction) | null;
  return trans !== null && trans[ALLOW_MARK] === true;
}

export function filedYearsSnapshot(): number[] {
  return [...filedYears].sort((a, b) => a - b);
}
// reportSnapshots の 1 行から「その年度が申告済みか」を読む。pl の filed だけが
// 年度ロックの根拠（snapshots.ts の isYearLocked と同じ条件）。
function marksYearFiled(row: ReportSnapshot): boolean {
  return row.type === 'pl' && row.status === 'filed';
}

function applySnapshotRows(rows: readonly ReportSnapshot[]): void {
  for (const row of rows) {
    if (row.type !== 'pl') {
      continue;
    }
    if (marksYearFiled(row)) {
      filedYears.add(row.year);
    } else {
      // superseded へ落ちた（ロック解除・修正申告）ぶんを外す。
      filedYears.delete(row.year);
    }
  }
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

function blockedYears(values: readonly unknown[]): number[] {
  const hit = new Set<number>();
  for (const value of values) {
    const entry = value as Partial<JournalEntry> | null;
    const year = entry?.year;
    if (typeof year !== 'number' || !filedYears.has(year)) {
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
    hit.add(year);
  }
  return [...hit].sort((a, b) => a - b);
}
/**
 * 書き込みの通り道に門を差し込む。db.open() より前に呼ぶ。
 *
 * journalEntries：申告済み年度への add/put を止める。delete は見ない——訂正は反対仕訳で
 * 行う決まりで、確定仕訳を物理削除する経路はそもそも無い（#332）。全消し（clear）は
 * 復元だけが行い、そこは印を付けて通す。
 *
 * reportSnapshots：申告の記録そのものなので、書き込みを拾って記憶を更新する。これで
 * 「申告した直後の書き込み」が古い記憶で素通りすることを防ぐ。
 */
export function installFiledYearGuard(db: Dexie): void {
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
              if (name === 'journalEntries' && !isAllowed()) {
                const blocked = blockedYears(values);
                if (blocked.length > 0) {
                  throw new FiledYearError(blocked);
                }
              }
              const result = await table.mutate(req);
              if (name === 'reportSnapshots') {
                applySnapshotRows(values as ReportSnapshot[]);
              }
              return result;
            },
          };
        },
      };
    },
  });
  // 開くたびに読み直す。ready は最初の取引が完了する前に走るので、門が空の記憶で
  // 判定してしまう隙間は空かない。
  //
  // 第 3 引数の sticky が要る。Dexie の ready は既定で一度発火したら購読が外れるため、
  // 付けないと db.delete() 後の開き直しで読み直されず、前のデータベースの年度が
  // 記憶に residual として残る（復元後や、テストのように張り直す経路で必ず起きる）。
  db.on(
    'ready',
    async () => {
      await refreshFiledYears(db);
    },
    true,
  );
}
