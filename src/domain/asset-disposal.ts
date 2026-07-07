import { D } from '../lib/decimal';
import { toIndexable } from '../lib/decimal';
import { newId } from '../lib/id';
import { db } from '../db/db';
import { countsTowardTotals } from './journal';
import { computeDepreciation } from './depreciation';
import type { DisposalType, FixedAsset, JournalEntry, JournalLine } from '../db/types';
// 固定資産の除却・売却（B6）。
//
// 除却（対価なし）：帳簿価額（未償却残高）全額を必要経費「固定資産除却損」に計上する。
// 三社（freee/やよい/MFクラウド）とも扱いは一致。
//
// 売却（対価あり）：個人事業主の事業用資産売却は事業所得ではなく譲渡所得（分離課税）
// に該当し、損益計算書に含めてはいけない。freee 方式（事業主貸/事業主借で売却対価と
// 帳簿価額の差額を結転し、損益計算書に一切触れない）を採用した。理由：
//   - aoiko は既に事業主貸/事業主借を「事業と個人の境界を跨ぐ取引」の結転に
//     使っており（家事按分・年末元入金振替）、資産売却も同じ性質の取引として
//     構造的に一貫する
//   - 通用（MF系）の「固定資産売却損益」科目方式は、損益表科目でありながら
//     事業所得の集計からは除外する必要があり、その除外ロジックを新しい集計機能
//     （報表・xtx出力）を追加するたびに書き漏らすリスクがある
// 譲渡所得そのものの試算は estimateTransferIncome() で別途参考値として提供する
// （分離課税の税額計算・特別控除の判定は行わない。詳細は同関数のコメント参照）。
//
// 一括償却資産（施行令139条）は除却・売却後も3年均等償却の継続が法律上必須で、
// 未償却残高の早期損金算入が認められない。除却/売却の対価と帳簿価額の関係が
// 通常の資産と異なり本モジュールでは扱いを確定できないため、対応対象外とする。

const DISPOSAL_LOSS_ACCOUNT = '5280';
const ACCUMULATED_DEPRECIATION_ACCOUNT = '1520';
const OWNER_DRAW_ACCOUNT = '1610'; // 事業主貸
const OWNER_CONTRIBUTION_ACCOUNT = '3120'; // 事業主借
const DEFAULT_CASH_ACCOUNT = '1110';

const DISPOSAL_MARKER: Record<DisposalType, string> = {
  scrap: '固定資産除却',
  sale: '固定資産売却',
};

export interface DisposalLineSpec {
  side: 'debit' | 'credit';
  accountCode: string;
  amount: string;
}
// 除却/売却時点（disposedDate の年）における累計償却額・帳簿価額を返す。
export function disposalBookValue(asset: FixedAsset): {
  accumulatedEnd: string;
  bookValueEnd: string;
} {
  if (!asset.disposedDate) {
    throw new Error('disposedDate が未設定です');
  }
  const disposedYear = Number(asset.disposedDate.slice(0, 4));
  const result = computeDepreciation(asset, disposedYear);
  return { accumulatedEnd: result.accumulatedEnd, bookValueEnd: result.bookValueEnd };
}
// 除却/売却の仕訳明細を組み立てる純粋関数（DB へは書き込まない）。
export function buildDisposalLines(
  asset: FixedAsset,
  cashAccountCode: string = DEFAULT_CASH_ACCOUNT
): DisposalLineSpec[] {
  if (asset.depreciationMethod === 'lump-sum') {
    throw new Error('一括償却資産の除却・売却仕訳には対応していません');
  }
  const { accumulatedEnd, bookValueEnd } = disposalBookValue(asset);
  const cost = D(asset.acquisitionCost);
  const disposalType: DisposalType = asset.disposalType ?? 'scrap';

  if (disposalType === 'sale') {
    if (!asset.salePrice) {
      throw new Error('売却には salePrice が必要です');
    }
    const salePrice = D(asset.salePrice);
    const diff = salePrice.minus(bookValueEnd);
    const lines: DisposalLineSpec[] = [
      { side: 'debit', accountCode: cashAccountCode, amount: salePrice.toString() },
    ];
    if (D(accumulatedEnd).greaterThan(0)) {
      lines.push({ side: 'debit', accountCode: ACCUMULATED_DEPRECIATION_ACCOUNT, amount: accumulatedEnd });
    }
    if (diff.greaterThan(0)) {
      lines.push({ side: 'credit', accountCode: OWNER_CONTRIBUTION_ACCOUNT, amount: diff.toString() });
    } else if (diff.lessThan(0)) {
      lines.push({ side: 'debit', accountCode: OWNER_DRAW_ACCOUNT, amount: diff.abs().toString() });
    }
    lines.push({ side: 'credit', accountCode: asset.accountCode, amount: cost.toString() });
    return lines;
  }

  const lines: DisposalLineSpec[] = [];
  if (D(bookValueEnd).greaterThan(0)) {
    lines.push({ side: 'debit', accountCode: DISPOSAL_LOSS_ACCOUNT, amount: bookValueEnd });
  }
  if (D(accumulatedEnd).greaterThan(0)) {
    lines.push({ side: 'debit', accountCode: ACCUMULATED_DEPRECIATION_ACCOUNT, amount: accumulatedEnd });
  }
  lines.push({ side: 'credit', accountCode: asset.accountCode, amount: cost.toString() });
  return lines;
}

export interface DisposalEntryResult {
  created: boolean;
  reason?: 'no-disposal' | 'already-exists' | 'missing-sale-price' | 'lump-sum-unsupported';
}
// 除却/売却の仕訳を実際に作成する。既に同じ資産・同マーカーの仕訳がある場合はスキップ
// （generateYearEndDepreciation と同じ重複防止パターン）。
export async function generateDisposalEntry(
  assetId: string,
  cashAccountCode: string = DEFAULT_CASH_ACCOUNT
): Promise<DisposalEntryResult> {
  const asset = await db.fixedAssets.get(assetId);
  const disposedDate = asset?.disposedDate;
  if (!asset || !disposedDate) {
    return { created: false, reason: 'no-disposal' };
  }
  if (asset.depreciationMethod === 'lump-sum') {
    return { created: false, reason: 'lump-sum-unsupported' };
  }
  const disposalType: DisposalType = asset.disposalType ?? 'scrap';
  if (disposalType === 'sale' && !asset.salePrice) {
    return { created: false, reason: 'missing-sale-price' };
  }

  const year = Number(disposedDate.slice(0, 4));
  const tag = `#${asset.id.slice(0, 8)}`;
  const marker = DISPOSAL_MARKER[disposalType];

  const existing = await db.journalEntries
    .where('[year+date]')
    .equals([year, disposedDate])
    .filter(
      (e) => countsTowardTotals(e) && e.description.includes(tag) && e.description.includes(marker)
    )
    .first();
  if (existing) {
    return { created: false, reason: 'already-exists' };
  }

  const lines = buildDisposalLines(asset, cashAccountCode);
  const entryId = newId();
  const now = Date.now();
  const description = `${marker} ${asset.name} ${tag}`;

  await db.transaction('rw', [db.journalEntries, db.journalLines], async () => {
    await db.journalEntries.add({
      id: entryId,
      date: disposedDate,
      year,
      description,
      status: 'confirmed',
      source: 'manual',
      createdAt: now,
      confirmedAt: now,
    } satisfies JournalEntry);

    const journalLines: JournalLine[] = lines.map((l) => ({
      id: newId(),
      entryId,
      side: l.side,
      accountCode: l.accountCode,
      amount: l.amount,
      amountIndexed: toIndexable(l.amount),
      taxRate: 0,
      taxIncluded: true,
      invoiceCompliant: false,
    }));
    await db.journalLines.bulkAdd(journalLines);
  });

  return { created: true };
}

export interface TransferIncomeEstimate {
  proceeds: string;
  acquisitionExpense: string;
  saleExpenses: string;
  /** 概算譲渡所得 = 譲渡収入 − 取得費（帳簿価額） − 譲渡費用。特別控除は未反映 */
  estimate: string;
  /** 取得日から売却日までの満年数（参考値。分離課税の長期/短期判定は利用者が別途確認する） */
  holdingYears: number;
}
// 譲渡所得の参考試算（分離課税、事業所得には含めない）。
// 特別控除（最高50万円、要件充足時のみ）・短期/長期の税率適用は行わない。
// 確定申告書第三表（分離課税用）は本試算の対象外で、利用者が別途申告する。
export function estimateTransferIncome(asset: FixedAsset): TransferIncomeEstimate | null {
  if (asset.disposalType !== 'sale' || !asset.disposedDate || !asset.salePrice) {
    return null;
  }
  const { bookValueEnd } = disposalBookValue(asset);
  const proceeds = D(asset.salePrice);
  const saleExpenses = D(asset.saleExpenses ?? '0');
  const estimate = proceeds.minus(bookValueEnd).minus(saleExpenses);
  const acqMs = new Date(asset.acquisitionDate).getTime();
  const dispMs = new Date(asset.disposedDate).getTime();
  const holdingYears = Math.floor((dispMs - acqMs) / (365.25 * 24 * 3600 * 1000));
  return {
    proceeds: proceeds.toString(),
    acquisitionExpense: bookValueEnd,
    saleExpenses: saleExpenses.toString(),
    estimate: estimate.toString(),
    holdingYears,
  };
}