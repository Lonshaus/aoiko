import { D } from '../lib/decimal';
import { newId } from '../lib/id';

// 家事按分の自動分解。借方明細で homeOfficeRatio が 1 未満の場合、
// 「事業使用分（経費）」と「個人使用分（1610 事業主貸）」の 2 行に分解する。
// 個人使用分は複数行から合算して 1 行にまとめる（仕訳全体の可読性向上）。

const DRAWING_ACCOUNT_CODE = '1610';  // 事業主貸

export interface SplittableLine {
  id: string;
  side: 'debit' | 'credit';
  accountCode: string;
  subAccountId: string;
  amount: string;          // Decimal 字串、円単位
  taxRate: number;
  taxIncluded: boolean;
  homeOfficeRatio: string; // '' = 適用しない、'0' .. '1' の Decimal 字串
}

export class HomeOfficeRatioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HomeOfficeRatioError';
  }
}

// homeOfficeRatio が有効な値か検証。空文字、'1'、'0' .. '1' の範囲のみ許可。
function parseRatio(ratio: string): { apply: boolean; value: ReturnType<typeof D> } {
  const trimmed = ratio.trim();
  if (trimmed === '' || trimmed === '1' || trimmed === '1.0' || trimmed === '1.00') {
    return { apply: false, value: D(1) };
  }
  let d;
  try {
    d = D(trimmed);
  } catch {
    throw new HomeOfficeRatioError(`家事按分比率の値が不正です: ${ratio}`);
  }
  if (d.lessThan(0) || d.greaterThan(1)) {
    throw new HomeOfficeRatioError(
      `家事按分比率は 0 〜 1 の範囲で指定してください: ${ratio}`
    );
  }
  if (d.isZero()) {
    throw new HomeOfficeRatioError(
      '家事按分比率が 0% の行は意味がないため登録できません'
    );
  }
  return { apply: true, value: d };
}

// 借方明細群を受け取り、家事按分のあるものを分解した新しい配列を返す。
// 個人使用分（事業主貸）は合算され、必要なら 1 行追加される。
export function expandHomeOffice(debits: SplittableLine[]): SplittableLine[] {
  const result: SplittableLine[] = [];
  let drawingTotal = D(0);

  for (const line of debits) {
    if (line.side !== 'debit') {
      result.push(line);
      continue;
    }
    const { apply, value: ratio } = parseRatio(line.homeOfficeRatio);
    if (!apply) {
      result.push(line);
      continue;
    }

    const fullAmount = D(line.amount);
    if (fullAmount.isZero()) {
      result.push(line);
      continue;
    }

    // 事業使用分（四捨五入）、個人使用分は差額で計算（円が消えないように）
    const businessAmount = fullAmount.times(ratio).toDecimalPlaces(0);
    const personalAmount = fullAmount.minus(businessAmount);

    if (businessAmount.isZero()) {
      // 結果としてゼロになる場合、ratio が小さすぎたか金額が小さすぎる → 全額個人扱い
      drawingTotal = drawingTotal.plus(personalAmount);
      continue;
    }

    result.push({
      ...line,
      amount: businessAmount.toString(),
    });
    drawingTotal = drawingTotal.plus(personalAmount);
  }

  if (drawingTotal.greaterThan(0)) {
    result.push({
      id: newId(),
      side: 'debit',
      accountCode: DRAWING_ACCOUNT_CODE,
      subAccountId: '',
      amount: drawingTotal.toString(),
      taxRate: 0,
      taxIncluded: true,
      homeOfficeRatio: '',
    });
  }

  return result;
}