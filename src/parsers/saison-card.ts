import { parseCsv } from '../lib/csv';
import {
  applySign,
  buildRawRow,
  findHeaderRow,
  normalizeDate,
  optionalColumn,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// セゾンカード（Net Answer）の利用明細 CSV（実データ確認済）。
// エンコーディング：Shift_JIS
// 前言：カード名称 / お支払日 / 今回ご請求額 の 3 行 ＋ 空行の後に表頭が来る。
// 表頭：利用日, ご利用店名及び商品名, 本人・家族区分, 支払区分名称,
//       締前入金区分, 利用金額, 備考
// クレジットカードのため、全行 credit 側（未払金 増加）。

const DISPLAY = 'セゾンカード';
const REQUIRED = ['利用日', 'ご利用店名及び商品名', '利用金額'] as const;

const saisonCardParser: CsvParser = {
  name: 'saison-card',
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
    const idxKubun = optionalColumn(header, '本人・家族区分');
    const idxShiharai = optionalColumn(header, '支払区分名称');
    const idxBiko = optionalColumn(header, '備考');

    const result: ParsedTransaction[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['利用日']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['ご利用店名及び商品名']!] ?? '').trim();
      const amountRaw = (row[idx['利用金額']!] ?? '').trim();
      if (!amountRaw) {
        continue;
      }

      const memoParts: string[] = [];
      if (idxKubun >= 0) {
        const k = (row[idxKubun] ?? '').trim();
        if (k && k !== '本人') {
          memoParts.push(k);
        }
      }
      if (idxShiharai >= 0) {
        const s = (row[idxShiharai] ?? '').trim();
        if (s && s !== '1回') {
          memoParts.push(s);
        }
      }
      if (idxBiko >= 0) {
        const b = (row[idxBiko] ?? '').trim();
        if (b) {
          memoParts.push(b);
        }
      }
      const memo = memoParts.length > 0 ? memoParts.join(' / ') : undefined;
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

export default saisonCardParser;
export { saisonCardParser };
