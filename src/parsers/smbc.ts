import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// 三井住友銀行 SMBCダイレクト の CSV 形式（実データ確認済）。
// エンコーディング：Shift_JIS
// ヘッダー：年月日, お引出し, お預入れ, お取り扱い内容, 残高, メモ, ラベル

const DISPLAY = '三井住友銀行';
const REQUIRED = ['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容'] as const;

const smbcParser: CsvParser = {
  name: 'smbc',
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
      const dateRaw = (row[idx['年月日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['お取り扱い内容']!] ?? '').trim();
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
        const b = (row[idxBalance] ?? '').trim();
        if (b) {
          transaction.balance = stripComma(b);
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

export default smbcParser;
export { smbcParser };