import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// PayPayカード（旧 ヤフーカード）会員メニューの利用明細 CSV ダウンロード形式（暫定）。
// 2023-02-02 から提供開始。エンコーディングは過去 UTF-8 → Shift_JIS に変更された経緯あり。
// QR 決済の paypay.ts（accountCode 1130）とは別物。本 parser はクレジットカード（2120 未払金）。
// ヘッダー（暫定）：ご利用日, ご利用店名, ご利用金額, 支払区分, 摘要
// 数値：千分位カンマあり、利用金額は常に正の数（カード支払なので side: 'credit' 固定）
// 日付：YYYY/MM/DD
// TODO: 実 CSV で header 名・順序・encoding を検証

const DISPLAY = 'PayPayカード';
const REQUIRED = ['ご利用日', 'ご利用店名', 'ご利用金額'] as const;

const paypayCardParser: CsvParser = {
  name: 'paypay-card',
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
      const dateRaw = (row[idx['ご利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['ご利用店名']!] ?? '').trim();
      const amountRaw = (row[idx['ご利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }
      const amount = stripComma(amountRaw);

      const memoParts: string[] = [];
      if (idxPlan >= 0) {
        const p = (row[idxPlan] ?? '').trim();
        if (p && p !== '一括') {
          memoParts.push(p);
        }
      }
      if (idxNote >= 0) {
        const n = (row[idxNote] ?? '').trim();
        if (n) {
          memoParts.push(n);
        }
      }

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side: 'credit',
        rawRow: buildRawRow(header, row),
      };
      if (memoParts.length > 0) {
        transaction.memo = memoParts.join(' / ');
      }
      result.push(transaction);
    }
    return result;
  },
};

export default paypayCardParser;
export { paypayCardParser };