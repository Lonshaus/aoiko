import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// au PAY カード（旧 au WALLET クレジットカード）の利用明細 CSV（実データ確認済）。
// エンコーディング：Shift_JIS
// ヘッダー：ご利用者, 支払区分, 利用日, 利用店名, 利用金額, 摘要
// クレジットのため全行 credit 側（未払金 増加）。

const DISPLAY = 'au PAY カード';
const REQUIRED = ['利用日', '利用店名', '利用金額'] as const;

const auPayCardParser: CsvParser = {
  name: 'aupay-card',
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
    const idxPlan = optionalColumn(header, '支払区分');
    const idxNote = optionalColumn(header, '摘要');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['利用店名']!] ?? '').trim();
      const amountRaw = (row[idx['利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }

      const memoParts: string[] = [];
      if (idxPlan >= 0) {
        const p = (row[idxPlan] ?? '').trim();
        if (p && p !== '通常払い') {
          memoParts.push(p);
        }
      }
      if (idxNote >= 0) {
        const n = (row[idxNote] ?? '').trim();
        if (n) {
          memoParts.push(n);
        }
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount: stripComma(amountRaw),
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

export default auPayCardParser;
export { auPayCardParser };