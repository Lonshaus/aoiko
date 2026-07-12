// 新しい CSV パーサーを追加するためのテンプレート。
// このファイルは Auto-discovery から除外されます（先頭の _ により）。
//
// 使い方:
//   1. このファイルを `my-bank.ts` 等にリネーム
//   2. 値を実際の銀行/カードのものに置換
//   3. `_template.example.test.ts` を同じ名前でコピー、テストを書く
//   4. `fixtures/my-bank-sample.csv` を匿名化したサンプルとして作成
//   5. `npm run test` で検証
//   6. PR を投げる
//
// 詳細は CONTRIBUTING.md を参照。

import { parseCsv } from '../lib/csv';
import { buildRawRow, normalizeDate, optionalColumn, requireColumns, stripComma } from './_helpers';
import type { CsvParser, ParsedTransaction } from './types';

const DISPLAY = 'マイ銀行';
const REQUIRED = ['日付', '摘要', '出金額', '入金額'] as const;

const myBankParser: CsvParser = {
  name: 'my-bank',
  displayName: DISPLAY,
  accountCode: '1130', // 1110 現金 / 1130 普通預金 / 2120 未払金（カード） から選ぶ
  encoding: 'shift_jis', // 'utf-8' or 'shift_jis'
  parse(text: string): ParsedTransaction[] {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return [];
    }
    const header = rows[0]!;
    const idx = requireColumns(header, REQUIRED, DISPLAY);
    const idxBalance = optionalColumn(header, '残高');

    const result: ParsedTransaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const dateRaw = (row[idx['日付']!] ?? '').trim();
      if (!dateRaw) {
        continue;
      }
      const description = (row[idx['摘要']!] ?? '').trim();
      const outRaw = (row[idx['出金額']!] ?? '').trim();
      const inRaw = (row[idx['入金額']!] ?? '').trim();

      let amount: string;
      let side: 'debit' | 'credit';
      if (outRaw && !inRaw) {
        amount = stripComma(outRaw);
        side = 'credit'; // 普通預金から出金 = 貸方
      } else if (inRaw && !outRaw) {
        amount = stripComma(inRaw);
        side = 'debit'; // 普通預金へ入金 = 借方
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
      result.push(transaction);
    }
    return result;
  },
};

export default myBankParser;
