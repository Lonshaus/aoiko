import { parseCsv } from '../lib/csv';
import { buildRawRow, normalizeDate, optionalColumn, requireColumns, stripComma } from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';
// 三菱UFJ 銀行 Direct ダウンロードの CSV 形式（実データ確認済）。
// エンコーディング：Shift_JIS
// ヘッダー：日付, 摘要, 摘要内容, 支払い金額, 預かり金額, 差引残高,
//           メモ, 未資金化区分, 入払区分
// 説明：摘要内容（詳細）優先、無ければ摘要をフォールバック

const DISPLAY = '三菱UFJ 銀行';
const REQUIRED = ['日付', '摘要', '支払い金額', '預かり金額'] as const;

const mufgParser: CsvParser = {
  name: 'mufg',
  displayName: DISPLAY,
  accountCode: '1130',
  encoding: 'shift_jis',
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxDetail = optionalColumn(header, '摘要内容');
    const idxBalance = optionalColumn(header, '差引残高');
    const idxMemo = optionalColumn(header, 'メモ');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['日付']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const summary = (row[idx['摘要']!] ?? '').trim();
      const detail = idxDetail >= 0 ? (row[idxDetail] ?? '').trim() : '';
      const description = detail || summary;

      const outRaw = (row[idx['支払い金額']!] ?? '').trim();
      const inRaw = (row[idx['預かり金額']!] ?? '').trim();

      let amount: string;
      let side: 'debit' | 'credit';
      if (outRaw && !inRaw) {
        amount = stripComma(outRaw);
        side = 'credit';
      } else if (inRaw && !outRaw) {
        amount = stripComma(inRaw);
        side = 'debit';
      } else {
        continue;
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
      if (idxMemo >= 0) {
        const memo = (row[idxMemo] ?? '').trim();
        if (memo) {
          transaction.memo = memo;
        }
      }
      result.push(transaction);
    }
    return result;
  },
};

export default mufgParser;
export { mufgParser };
