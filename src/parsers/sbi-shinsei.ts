import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// SBI新生銀行 パワーダイレクトの入出金明細 CSV ダウンロード形式（暫定）。
// 旧「新生銀行」が 2023-01 に SBI 集団へ加入し改名した個人向け銀行。
// 住信SBIネット銀行（sbi-hybrid）とは別行なので注意。
// エンコーディング：Shift_JIS（多くの邦銀 CSV の既定。UTF-8 で配信される個体も許容）
// ヘッダー（暫定）：取引日, 摘要, お引出し, お預入れ, 残高, メモ
// 数値：千分位カンマあり、片側のみ取引（出金 or 入金）
// 日付：YYYY/MM/DD
// TODO: 実 CSV で header 名・順序・encoding を検証して必要なら修正する

const DISPLAY = 'SBI新生銀行';
const REQUIRED = ['取引日', '摘要', 'お引出し', 'お預入れ'] as const;

const sbiShinseiParser: CsvParser = {
  name: 'sbi-shinsei',
  displayName: DISPLAY,
  accountCode: '1130',
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxBalance = optionalColumn(header, '残高');
    const idxMemo = optionalColumn(header, 'メモ');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['取引日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['摘要']!] ?? '').trim();
      const outRaw = (row[idx['お引出し']!] ?? '').trim();
      const inRaw = (row[idx['お預入れ']!] ?? '').trim();

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

export default sbiShinseiParser;
export { sbiShinseiParser };