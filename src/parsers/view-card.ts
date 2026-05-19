import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  findHeaderRow,
  isDateLike,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// ビューカード（VIEW's NET。JRE CARD 等）の利用明細 CSV（実データ確認済）。
// エンコーディング：Shift_JIS
// 前言：会員番号 / 対象カード / お支払日 / 今回お支払金額 の 4 行 ＋ 空行の後に表頭。
// 表頭：ご利用年月日, ご利用箇所, ご利用額, 払戻額,
//       ご請求額（うち手数料・利息）, 支払区分（回数）, 今回回数,
//       今回ご請求額・弁済金（うち手数料・利息）, 現地通貨額, 通貨略称, 換算レート
// 表頭の直後に「****-****-****-XXXX 氏名」のカード会員行（1 セル）が挟まるため、
// 日付らしくない行は読み飛ばす。
// ご利用額があれば credit（未払金 増）、払戻額のみなら debit（未払金 減）。

const DISPLAY = 'ビューカード';
const REQUIRED = ['ご利用年月日', 'ご利用箇所', 'ご利用額'] as const;

const viewCardParser: CsvParser = {
  name: 'view-card',
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
    const idxRefund = optionalColumn(header, '払戻額');
    const idxMethod = optionalColumn(header, '支払区分（回数）');

    const result: ParsedTransaction[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['ご利用年月日']!] ?? '').trim();
      if (!isDateLike(dateRaw)) {
        continue;
      }
      const description = (row[idx['ご利用箇所']!] ?? '').trim();
      const useRaw = (row[idx['ご利用額']!] ?? '').trim();
      const refundRaw =
        idxRefund >= 0 ? (row[idxRefund] ?? '').trim() : '';

      let amount: string;
      let side: 'debit' | 'credit';
      if (useRaw) {
        amount = stripComma(useRaw);
        side = 'credit';
      } else if (refundRaw) {
        amount = stripComma(refundRaw);
        side = 'debit';
      } else {
        continue;
      }

      let memo: string | undefined;
      if (idxMethod >= 0) {
        const m = (row[idxMethod] ?? '').trim();
        if (m && m !== '１回払' && m !== '1回払') {
          memo = m;
        }
      }

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

export default viewCardParser;
export { viewCardParser };