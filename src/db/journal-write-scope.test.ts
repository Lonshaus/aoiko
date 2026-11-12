import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// 申告済み年度の保護は、仕訳を書く取引の範囲に reportSnapshots があることと、画面の確認で得た年度が
// 書き込みの印まで渡ることに依る。どちらが抜けても他のテストは通り、保護だけが黙って弱まるので、
// 原文で確かめる。
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

interface SourceFile {
  path: string;
  text: string;
}

function sourceFiles(): SourceFile[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
    .filter((p) => /\.(ts|svelte)$/.test(p) && !/\.test\.(svelte\.)?ts$/.test(p))
    .map((p) => ({ path: p.split(sep).join('/'), text: readFileSync(join(SRC, p), 'utf-8') }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}
// db.transaction( の引数のうち、取引の本体（=> か function）より前の部分。
function transactionArgs(text: string, start: number): string {
  let depth = 0;
  let end = start;
  for (; end < text.length; end++) {
    if (text.startsWith('=>', end) || text.startsWith('function', end)) {
      break;
    }
    const ch = text.charAt(end);
    if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      if (depth === 0) {
        break;
      }
      depth--;
    }
  }
  return text.slice(start, end);
}

interface TransactionCall {
  at: string;
  args: string;
}

function transactionCalls(files: SourceFile[]): TransactionCall[] {
  const calls: TransactionCall[] = [];
  for (const { path, text } of files) {
    for (const match of text.matchAll(/\bdb\.transaction\(/g)) {
      calls.push({
        at: `${path}:${lineOf(text, match.index)}`,
        args: transactionArgs(text, match.index + match[0].length),
      });
    }
  }
  return calls;
}

function writesJournalEntries(call: TransactionCall): boolean {
  return /['"](rw|readwrite)[!?]?['"]/.test(call.args) && call.args.includes('db.journalEntries');
}

const files = sourceFiles();

describe('仕訳を書く取引の範囲', () => {
  const journalWrites = transactionCalls(files).filter(writesJournalEntries);

  test('reportSnapshots（または全表）を範囲に含む', () => {
    const missing = journalWrites.filter(
      (c) => !c.args.includes('db.reportSnapshots') && !c.args.includes('db.tables'),
    );
    expect(missing.map((c) => c.at)).toEqual([]);
  });
  // 取引の数え漏れ（書き方を変えて判定から外れた取引）が無いことを、場所の一覧で押さえる。
  test('仕訳を書く取引はこの 18 箇所', () => {
    expect(journalWrites.map((c) => c.at).sort()).toEqual(
      [
        'domain/asset-disposal.ts:332',
        'domain/bad-debt-reversal.ts:90',
        'domain/business-opening.ts:489',
        'domain/business-opening.ts:618',
        'domain/business-opening.ts:654',
        'domain/business-opening.ts:860',
        'domain/business-opening.ts:1104',
        'domain/carryover.ts:236',
        'domain/carryover.ts:335',
        'domain/depreciation.ts:1154',
        'domain/entry-date-fix.ts:88',
        'domain/import.ts:69',
        'domain/invoice.ts:208',
        'domain/reverse.ts:49',
        'domain/snapshots.ts:6',
        'routes/JournalEntryForm.svelte:382',
        'routes/OrderImport.svelte:284',
        'routes/Receipt.svelte:309',
      ].sort(),
    );
  });
});

describe('画面の確認で得た年度の受け渡し', () => {
  const CONFIRM = 'filedYearGuard.confirm(';
  const CONSENT = 'const consent = await filedYearGuard.confirm(';

  function confirmSites(): { at: string; declared: boolean; rest: string }[] {
    const sites: { at: string; declared: boolean; rest: string }[] = [];
    for (const { path, text } of files) {
      const starts: number[] = [];
      for (let i = text.indexOf(CONFIRM); i >= 0; i = text.indexOf(CONFIRM, i + 1)) {
        starts.push(i);
      }
      starts.forEach((start, k) => {
        const declStart = start - (CONSENT.length - CONFIRM.length);
        sites.push({
          at: `${path}:${lineOf(text, start)}`,
          declared: declStart >= 0 && text.startsWith(CONSENT, declStart),
          rest: text.slice(start, starts[k + 1] ?? text.length),
        });
      });
    }
    return sites;
  }

  test('確認はすべて const consent で受け、全部で 18 箇所', () => {
    const sites = confirmSites();
    expect(sites.filter((s) => !s.declared).map((s) => s.at)).toEqual([]);
    expect(sites).toHaveLength(18);
  });

  test('確認の後で consent を書き込みの印か allowedFiledYears へ渡す', () => {
    const notPassed = confirmSites().filter(
      (s) =>
        !s.rest.includes('allowFiledYearWriteInThisTransaction(consent)') &&
        !s.rest.includes('allowedFiledYears: consent'),
    );
    expect(notPassed.map((s) => s.at)).toEqual([]);
  });

  test('年度を渡さない印と、旧い allowFiledYear の指定は残っていない', () => {
    const offending = files
      .filter(
        ({ text }) =>
          /allowFiledYearWriteInThisTransaction\(\s*\)/.test(text) ||
          /\ballowFiledYear\??:/.test(text),
      )
      .map((f) => f.path);
    expect(offending).toEqual([]);
  });

  test('全部通す印を付けるのは復元だけ', () => {
    const callers = files
      .filter(
        ({ path, text }) =>
          path !== 'db/filed-year-guard.ts' &&
          text.includes('allowAllFiledYearWritesInThisTransaction('),
      )
      .map((f) => f.path);
    expect(callers).toEqual(['domain/restore.ts']);
  });
});
