import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// JCB MyJCB の CSV 形式（推定）。
// エンコーディング：Shift_JIS
// ヘッダー：ご利用日, ご利用先, ご利用金額, お支払金額, 摘要
// TODO: 実際の CSV で確認・修正

const DISPLAY = 'JCBカード';
const REQUIRED = ['ご利用日', 'ご利用先', 'ご利用金額'] as const;

const jcbCardParser: CsvParser = {
  name: 'jcb-card',
  displayName: DISPLAY,
  accountCode: '2120',
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxNote = optionalColumn(header, '摘要');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['ご利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['ご利用先']!] ?? '').trim();
      const amountRaw = (row[idx['ご利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }
      const amount = stripComma(amountRaw);

      let memo: string | undefined;
      if (idxNote >= 0) {
        const m = (row[idxNote] ?? '').trim();
        if (m) {
          memo = m;
        }
      }

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side: 'credit',
        rawRow: buildRawRow(header, row),
      };
      if (memo) {
        transaction.memo = memo;
      }
      result.push(transaction);
    }
    return result;
  },
};

export default jcbCardParser;
export { jcbCardParser };