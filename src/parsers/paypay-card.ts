import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// PayPayカード（旧 ヤフーカード）会員メニューの利用明細 CSV（実データ確認済）。
// QR 決済の paypay.ts（accountCode 1130）とは別物。本 parser はクレジットカード（2120 未払金）。
// エンコーディング：UTF-8（BOM 付き。parseCsv が BOM を除去する）
// ヘッダー：利用日/キャンセル日, 利用店名・商品名, 利用者, 決済方法, 支払区分,
//           利用金額, 手数料, 支払総額, 当月支払金額, 翌月以降繰越金額,
//           調整額, 当月お支払日
// 数値：千分位カンマあり、利用金額は常に正の数（カード支払なので side: 'credit' 固定）

const DISPLAY = 'PayPayカード';
const REQUIRED = ['利用日/キャンセル日', '利用店名・商品名', '利用金額'] as const;

const paypayCardParser: CsvParser = {
  name: 'paypay-card',
  displayName: DISPLAY,
  accountCode: '2120',
  encoding: 'utf-8',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxPlan = optionalColumn(header, '支払区分');
    const idxUser = optionalColumn(header, '利用者');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['利用日/キャンセル日']!] ?? '').trim();
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
        if (u && u !== '本人' && u !== '本人*') {
          memoParts.push(u);
        }
      }
      if (idxPlan >= 0) {
        const p = (row[idxPlan] ?? '').trim();
        if (p && p !== '1回' && p !== '一括') {
          memoParts.push(p);
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