import { db } from '../db/db';
import { D } from '../lib/decimal';
import { buildBS, buildPL } from './reports';
import type { PLData } from '../db/types';

export interface AmendmentDiff {
  year: number;
  filedAt: number;
  filedNetIncome: string;
  currentNetIncome: string;
  netIncomeDelta: string;
  filedTotalRevenue: string;
  currentTotalRevenue: string;
  filedTotalExpense: string;
  currentTotalExpense: string;
  hasChange: boolean;
}

// 申告済み年度の filed スナップショットと現在の集計結果を比較し、
// 訂正仕訳によってどれだけ数値が変わったかを返す。
// 修正申告（amended return）の提出要否判断・提出用差分把握に使う。
export async function getAmendmentDiff(year: number): Promise<AmendmentDiff | null> {
  const snap = await db.reportSnapshots
    .where('[year+type+status]')
    .equals([year, 'pl', 'filed'])
    .first();
  if (!snap || snap.payload.type !== 'pl') {
    return null;
  }
  const filed = snap.payload.data as PLData;

  const current = await buildPL(year);

  const delta = D(current.netIncome).minus(filed.netIncome);
  const revDelta = D(current.totalRevenue).minus(filed.totalRevenue);
  const expDelta = D(current.totalExpense).minus(filed.totalExpense);

  return {
    year,
    filedAt: snap.filedAt ?? snap.generatedAt,
    filedNetIncome: filed.netIncome,
    currentNetIncome: current.netIncome,
    netIncomeDelta: delta.toString(),
    filedTotalRevenue: filed.totalRevenue,
    currentTotalRevenue: current.totalRevenue,
    filedTotalExpense: filed.totalExpense,
    currentTotalExpense: current.totalExpense,
    hasChange: !delta.isZero() || !revDelta.isZero() || !expDelta.isZero(),
  };
}

export interface AmendmentChecklistItem {
  key: string;
  label: string;
  detail: string;
}

// 修正申告の標準的な手順チェックリスト。UI で順番に提示する。
export function amendmentChecklist(year: number): AmendmentChecklistItem[] {
  return [
    {
      key: 'unlock',
      label: `${year} 年のロックを解除する`,
      detail: '設定 → レポート画面で「ロック解除」。filed スナップショットは履歴として残ります。',
    },
    {
      key: 'reverse',
      label: '誤った仕訳を訂正する',
      detail: '原仕訳の「訂正」ボタンで打消し仕訳（修正仕訳）を作成し、その後正しい仕訳を新規入力します。原仕訳は status=reversed として保存され削除されません（電子帳簿保存法）。',
    },
    {
      key: 'review',
      label: '修正後の PL / BS を確認',
      detail: 'レポート画面で、修正後の収益・経費・純利益が想定通りか検算します。',
    },
    {
      key: 'submit',
      label: 'e-Tax で修正申告',
      detail: 'e-Taxソフト(WEB版) の「申告・申請・納税」→「過去の申告を訂正」から修正申告書を作成・送信します。本ツールの .xtx 出力は当面オリジナル申告用です。',
    },
    {
      key: 'relock',
      label: '修正後の額で再ロック',
      detail: '修正申告送信後、レポート画面で再度「申告済みとしてロック」を実行し、新しいスナップショットを保存します。',
    },
  ];
}