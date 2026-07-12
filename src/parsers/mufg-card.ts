import { parseCsv } from '../lib/csv';
import {
  applySign,
  buildRawRow,
  isDateLike,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// 三菱UFJカード（旧 MUFG カード / DC カード系）の利用明細 CSV（実データ確認済）。
// 銀行口座の mufg.ts（1130）とは別物。本 parser はクレジットカード（2120 未払金）。
// エンコーディング：Shift_JIS
// ヘッダー：確定情報, お支払日, ご利用店名（海外ご利用店名／海外都市名）,
//           ご利用日, 支払回数, 何回目, ご利用金額（円）,
//           現地通貨額・通貨名称・換算レート
// 表頭直後に「,,【氏名 様】,,,,,」のカード会員行が挟まる（ご利用日が空）。
// 日付は和式「YYYY年M月D日」。ご利用日が日付らしくない行は読み飛ばす。
// クレジットのため全行 credit 側（未払金 増加）。

const DISPLAY = '三菱UFJカード';
const REQUIRED = [
  'ご利用店名（海外ご利用店名／海外都市名）',
  'ご利用日',
  'ご利用金額（円）',
] as const;

const mufgCardParser: CsvParser = {
  name: 'mufg-card',
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
    const idxCount = optionalColumn(header, '支払回数');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['ご利用日']!] ?? '').trim();
      if (!isDateLike(dateRaw)) {
        continue;
      }
      const description = (row[idx['ご利用店名（海外ご利用店名／海外都市名）']!] ?? '').trim();
      const amountRaw = (row[idx['ご利用金額（円）']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }

      let memo: string | undefined;
      if (idxCount >= 0) {
        const c = (row[idxCount] ?? '').trim();
        if (c && c !== '１' && c !== '1') {
          memo = `${c}回払い`;
        }
      }
      // 返金・キャンセル行は負数 → 絶対値 + debit（未払金の減少）
      const { amount, side } = applySign(stripComma(amountRaw), 'credit');

      const transaction: ParsedTransaction = {
        date: normalizeDate(dateRaw),
        description,
        amount,
        side,
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

export default mufgCardParser;
export { mufgCardParser };
