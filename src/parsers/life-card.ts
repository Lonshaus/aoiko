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
// ライフカード（LIFE-Web Desk）の利用明細 CSV（実データ確認済）。
// エンコーディング：Shift_JIS
// 前言：支払日 / 会員氏名 / カード名、当月ご請求金額の内訳、ご契約内容など
// 複数の小表が前後に並ぶ。明細表の表頭は次のとおり：
//   明細No., 契約, 回数, 利用日, 利用先, 利用金額, ATM利用料, 手数料,
//   支払総額, 支払回数/何回目, 当月支払金額, 支払残高
// 明細表の後ろにも別の内訳表（回数指定払・リボ等）が続くため、
// 利用日が日付らしくない行は読み飛ばす（後続表の見出し・データを除外）。
// クレジットのため全行 credit 側（未払金 増加）。

const DISPLAY = 'ライフカード';
const REQUIRED = ['利用日', '利用先', '利用金額'] as const;

const lifeCardParser: CsvParser = {
  name: 'life-card',
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
    const idxKeiyaku = optionalColumn(header, '契約');
    const idxKaisu = optionalColumn(header, '支払回数/何回目');

    const result: ParsedTransaction[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['利用日']!] ?? '').trim();
      if (!isDateLike(dateRaw)) {
        continue;
      }
      const description = (row[idx['利用先']!] ?? '').trim();
      const amountRaw = (row[idx['利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }

      const memoParts: string[] = [];
      if (idxKeiyaku >= 0) {
        const k = (row[idxKeiyaku] ?? '').trim();
        if (k && k !== 'ショッピング') {
          memoParts.push(k);
        }
      }
      if (idxKaisu >= 0) {
        const k = (row[idxKaisu] ?? '').trim();
        if (k && k !== '1回払') {
          memoParts.push(k);
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

export default lifeCardParser;
export { lifeCardParser };