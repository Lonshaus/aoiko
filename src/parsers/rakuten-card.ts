import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';

// 楽天カード 利用明細 CSV（推定）。
// エンコーディング：Shift_JIS
// ヘッダー：利用日, 利用店名・商品名, 利用者, 支払方法, 利用金額, 支払手数料, 支払総額, ...
// クレジットカードのため、すべての行は credit 側（未払金 増加）として扱う。
// 後日銀行口座から引落し時、別途仕訳（未払金/普通預金）が必要。
// TODO: 実際の CSV で確認・修正

const DISPLAY = '楽天カード';
const REQUIRED = ['利用日', '利用店名・商品名', '利用金額'] as const;

const rakutenCardParser: CsvParser = {
  name: 'rakuten-card',
  displayName: DISPLAY,
  accountCode: '2120',  // 未払金
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxUser = optionalColumn(header, '利用者');
    const idxMethod = optionalColumn(header, '支払方法');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['利用店名・商品名']!] ?? '').trim();
      const amountRaw = (row[idx['利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }
      const amount = stripComma(amountRaw);

      const memoParts: string[] = [];
      if (idxUser >= 0) {
        const u = (row[idxUser] ?? '').trim();
        if (u && u !== '本人') {
          memoParts.push(u);
        }
      }
      if (idxMethod >= 0) {
        const m = (row[idxMethod] ?? '').trim();
        if (m && m !== '1回') {
          memoParts.push(m);
        }
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side: 'credit',  // 未払金が増える方向
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

export default rakutenCardParser;
export { rakutenCardParser };