import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  findHeaderRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// JCB 発行カード（MyJCB Web 明細。リクルートカード等の提携カードも同形式）の
// 利用明細 CSV（実データ確認済）。
// エンコーディング：Shift_JIS
// 前言：今回のお支払日等 4 行 ＋「【ご利用明細】」行の後に表頭が来る。
// 表頭：ご利用者, カテゴリ, ご利用日, ご利用先など, ご利用金額(￥),
//       支払区分, 今回回数, 訂正サイン, お支払い金額(￥), 国内／海外, 摘要, 備考
// 取込額は「ご利用金額(￥)」（利用総額）。クレジットのため全行 credit 側。

const DISPLAY = 'JCBカード';
const REQUIRED = ['ご利用日', 'ご利用先など', 'ご利用金額(￥)'] as const;

const jcbCardParser: CsvParser = {
  name: 'jcb-card',
  displayName: DISPLAY,
  accountCode: '2120',
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    const headerIdx = findHeaderRow(rows, REQUIRED);
    if (headerIdx < 0) {
      requireColumns(rows[0] ?? [], REQUIRED, DISPLAY);
      return [];
    }
    const header = rows[headerIdx]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxNote = optionalColumn(header, '摘要');

    const result: ParsedTransaction[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['ご利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['ご利用先など']!] ?? '').trim();
      const amountRaw = (row[idx['ご利用金額(￥)']!] ?? '').trim();
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