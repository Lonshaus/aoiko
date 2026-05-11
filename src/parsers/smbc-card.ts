import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';

// 三井住友カード（NL 含む）Vpass の CSV 形式（推定）。
// エンコーディング：Shift_JIS
// ヘッダー：ご利用日, ご利用店名・ご利用内容, ご利用者, 支払方法, 利用金額, ...
// クレジットカードのため、すべての行は credit 側（未払金 増加）。
// TODO: 実際の CSV で確認・修正

const DISPLAY = '三井住友カード';
const REQUIRED = [
  'ご利用日',
  'ご利用店名・ご利用内容',
  '利用金額',
] as const;

const smbcCardParser: CsvParser = {
  name: 'smbc-card',
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
    const idxMethod = optionalColumn(header, '支払方法');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['ご利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (
        row[idx['ご利用店名・ご利用内容']!] ?? ''
      ).trim();
      const amountRaw = (row[idx['利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }
      const amount = stripComma(amountRaw);

      let memo: string | undefined;
      if (idxMethod >= 0) {
        const m = (row[idxMethod] ?? '').trim();
        if (m && m !== '1回払い') {
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

export default smbcCardParser;
export { smbcCardParser };