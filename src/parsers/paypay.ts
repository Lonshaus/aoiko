import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// PayPay 取引履歴 CSV（推定）。
// エンコーディング：UTF-8
// ヘッダー：取引日, 取引内容, 取引金額(円), 残高(円), 出金元/入金先
// 「取引金額」の符号で入出金を判定（負＝出金 → credit 側、正＝入金 → debit 側）。
// TODO: 実際の CSV で確認・修正（PayPay は複数の export 形式あり）

const DISPLAY = 'PayPay';
const REQUIRED = ['取引日', '取引内容', '取引金額(円)'] as const;

const paypayParser: CsvParser = {
  name: 'paypay',
  displayName: DISPLAY,
  accountCode: '1130',  // 普通預金 サブ口座 として扱う想定
  encoding: 'utf-8',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxBalance = optionalColumn(header, '残高(円)');
    const idxSource = optionalColumn(header, '出金元/入金先');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['取引日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['取引内容']!] ?? '').trim();
      const amountRaw = (row[idx['取引金額(円)']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }
      // 符号で入出金を判定。¥-2,500 のような表記、-2,500、2,500 すべて対応。
      const cleaned = amountRaw.replace(/[¥￥,\s]/g, '');
      const isNegative = cleaned.startsWith('-');
      const amount = cleaned.replace(/^[-+]/, '');
      if (!amount) {
        continue;
      }
      const side: 'debit' | 'credit' = isNegative ? 'credit' : 'debit';

      let memo: string | undefined;
      if (idxSource >= 0) {
        const s = (row[idxSource] ?? '').trim();
        if (s) {
          memo = s;
        }
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
      if (memo) {
        transaction.memo = memo;
      }
      result.push(transaction);
    }
    return result;
  },
};

export default paypayParser;
export { paypayParser };