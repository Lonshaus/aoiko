import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';

// 住信SBIネット銀行 ハイブリッド預金の CSV ダウンロード形式。
// エンコーディング：UTF-8（BOM 有無どちらも可）
// ヘッダー：日付, 内容, 出金金額(円), 入金金額(円), 残高(円), メモ
// 数値：千分位カンマあり、片側のみ取引（出金 or 入金）

const DISPLAY = '住信SBIネット銀行 ハイブリッド預金';
const REQUIRED = ['日付', '内容', '出金金額(円)', '入金金額(円)'] as const;

const sbiHybridParser: CsvParser = {
  name: 'sbi-hybrid',
  displayName: DISPLAY,
  accountCode: '1130',
  encoding: 'utf-8',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxBalance = optionalColumn(header, '残高(円)');
    const idxMemo = optionalColumn(header, 'メモ');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['日付']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['内容']!] ?? '').trim();
      const outRaw = (row[idx['出金金額(円)']!] ?? '').trim();
      const inRaw = (row[idx['入金金額(円)']!] ?? '').trim();

      let amount: string;
      let side: 'debit' | 'credit';
      if (outRaw && !inRaw) {
        amount = stripComma(outRaw);
        side = 'credit';
      } else if (inRaw && !outRaw) {
        amount = stripComma(inRaw);
        side = 'debit';
      } else {
        continue;
      }

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side,
        rawRow: buildRawRow(header, row),
      };
      if (idxBalance >= 0) {
        const balance = (row[idxBalance] ?? '').trim();
        if (balance) {
          transaction.balance = stripComma(balance);
        }
      }
      if (idxMemo >= 0) {
        const memo = (row[idxMemo] ?? '').trim();
        if (memo) {
          transaction.memo = memo;
        }
      }
      result.push(transaction);
    }
    return result;
  },
};

export default sbiHybridParser;
export { sbiHybridParser };