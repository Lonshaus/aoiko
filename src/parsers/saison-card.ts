import { parseCsv } from '../lib/csv';
import {
  buildRawRow,
  normalizeDate,
  requireColumns,
  stripComma,
} from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// セゾンカード Net Answer の CSV 形式（推定）。
// エンコーディング：Shift_JIS
// ヘッダー：ご利用日, ご利用店名, ご利用金額
// TODO: 実際の CSV で確認・修正

const DISPLAY = 'セゾンカード';
const REQUIRED = ['ご利用日', 'ご利用店名', 'ご利用金額'] as const;

const saisonCardParser: CsvParser = {
  name: 'saison-card',
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
      result.push({
        date: normalizeDate(dateRaw),
        description,
        amount: stripComma(amountRaw),
        side: 'credit',
        rawRow: buildRawRow(header, row),
      });
    }
    return result;
  },
};

export default saisonCardParser;
export { saisonCardParser };