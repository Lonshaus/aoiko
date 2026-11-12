import { db } from '../db/db';
import { isRestorableSettingKey } from '../backup/parts';
import { sha256Hex } from '../lib/sha256';
import { checkRow, clip, upgradeLegacyRow } from './restore-schema';
import {
  isReadableEntryDate,
  journalEntryProblem,
  journalLineProblem,
  PRIMARY_KEY,
  primaryKeyProblem,
} from './restore-validate';
// 端末に保存済みのデータを、バックアップの復元と同じ規則で確かめる。読むだけで直さない。
// 値は画面に文字として出すだけで、console には出さない。

export interface DataCheckTable {
  table: string;
  count: number;
  samples: string[];
}

export interface DataCheckResult {
  total: number;
  tables: DataCheckTable[];
  fingerprint: string;
}

type Row = Record<string, unknown>;
type KeyPath = string | readonly string[];

const MAX_SAMPLES = 3;
const PROTO_KEY_PROBLEM = '行に __proto__ という名前の欄があります';
// 表示を崩す制御文字と双方向の制御文字。
export const UNSAFE_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

function isObject(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// 主キーは文字列と有限の数値だけを示す。それ以外は String() を通さず行の番号で示す。
function showKey(key: KeyPath, raw: unknown, position: number): string {
  const shown: string[] = [];
  for (const field of typeof key === 'string' ? [key] : key) {
    const v = isObject(raw) && Object.hasOwn(raw, field) ? raw[field] : undefined;
    if (typeof v === 'string') {
      shown.push(clip(v));
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      shown.push(clip(String(v)));
    } else {
      return `${position} 行目`;
    }
  }
  return shown.join('/');
}

function rowProblem(table: string, key: KeyPath, raw: unknown): string | null {
  if (!isObject(raw)) {
    return primaryKeyProblem(key, raw);
  }
  const row: Row = { ...raw };
  if (Object.hasOwn(row, '__proto__')) {
    return PROTO_KEY_PROBLEM;
  }
  const problem =
    primaryKeyProblem(key, row) ??
    (table === 'journalEntries' ? journalEntryProblem(row) : null) ??
    (table === 'journalLines' ? journalLineProblem(row) : null);
  if (problem !== null) {
    return problem;
  }
  // 復元はできるが集計に正しく入らない。訂正済みのものは集計に入らないので挙げない。
  if (table === 'journalEntries' && row.status !== 'reversed' && !isReadableEntryDate(row.date)) {
    return 'date が YYYY-MM-DD ではありません';
  }
  if (table === 'settings' && !isRestorableSettingKey(row.key)) {
    return null;
  }
  if (!upgradeLegacyRow(table, row)) {
    return null;
  }
  return checkRow(table, row);
}

function lineReferenceProblem(raw: unknown, entryIds: ReadonlySet<string>): string | null {
  if (isObject(raw) && typeof raw.entryId === 'string' && !entryIds.has(raw.entryId)) {
    return `entryId に対応する仕訳がありません：${clip(raw.entryId)}`;
  }
  return null;
}

class Findings {
  private readonly byTable = new Map<string, DataCheckTable>();
  private readonly lines: string[] = [];

  add(table: string, keyShown: string, detail: string): void {
    let found = this.byTable.get(table);
    if (found === undefined) {
      found = { table, count: 0, samples: [] };
      this.byTable.set(table, found);
    }
    found.count += 1;
    if (found.samples.length < MAX_SAMPLES) {
      found.samples.push(`${keyShown}：${detail}`.replace(UNSAFE_CHARS, '�'));
    }
    this.lines.push(`${table}|${keyShown}|${detail}`);
  }
  // 指紋は全ての問題行から作る。同じ表で別の行に入れ替わっても変わるように。
  async result(): Promise<DataCheckResult> {
    const tables = Object.keys(PRIMARY_KEY).flatMap((name) => this.byTable.get(name) ?? []);
    const total = tables.reduce((sum, t) => sum + t.count, 0);
    const fingerprint =
      this.lines.length === 0
        ? ''
        : await sha256Hex(new TextEncoder().encode(this.lines.sort().join('\n')));
    return { total, tables, fingerprint };
  }
}

async function checkTable(name: string, key: KeyPath, findings: Findings): Promise<void> {
  const table = db.table(name);
  await db.transaction('r', table, async () => {
    let position = 0;
    await table.each((raw: unknown) => {
      position += 1;
      const detail = rowProblem(name, key, raw);
      if (detail !== null) {
        findings.add(name, showKey(key, raw, position), detail);
      }
    });
  });
}
// 明細と仕訳の対応は同じ時点で見る必要があるため、この 2 表だけ 1 つの取引で読む。
async function checkJournal(findings: Findings): Promise<void> {
  await db.transaction('r', [db.journalEntries, db.journalLines], async () => {
    const entryIds = new Set<string>();
    let position = 0;
    await db.journalEntries.each((raw: unknown) => {
      position += 1;
      if (isObject(raw) && typeof raw.id === 'string') {
        entryIds.add(raw.id);
      }
      const detail = rowProblem('journalEntries', PRIMARY_KEY.journalEntries!, raw);
      if (detail !== null) {
        findings.add('journalEntries', showKey('id', raw, position), detail);
      }
    });
    position = 0;
    await db.journalLines.each((raw: unknown) => {
      position += 1;
      const detail =
        rowProblem('journalLines', PRIMARY_KEY.journalLines!, raw) ??
        lineReferenceProblem(raw, entryIds);
      if (detail !== null) {
        findings.add('journalLines', showKey('id', raw, position), detail);
      }
    });
  });
}
/**
 * 保存済みの全表（stamps を除く）を 1 行ずつ確かめる。表ごとに読み取り専用の取引を分け、
 * 起動直後の書き込みを長く待たせない。1 行につき最初に見つかった問題を 1 つだけ数える。
 */
export async function checkStoredData(): Promise<DataCheckResult> {
  const findings = new Findings();
  await checkJournal(findings);
  for (const [name, key] of Object.entries(PRIMARY_KEY)) {
    if (name === 'journalEntries' || name === 'journalLines') {
      continue;
    }
    await checkTable(name, key, findings);
  }
  return findings.result();
}
