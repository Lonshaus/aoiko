import type { Account, AccountCategory } from '../db/types';
import { LlmError, type LlmAdapter } from './llm';
import { m } from '../paraglide/messages';

export interface ClassifyInput {
  /** 並び順識別。レスポンスとの対応を保証するために必須 */
  ref: string;
  description: string;
  amount: string;
}

interface ClassifySuggestion {
  ref: string;
  /** 提案された対方科目 code、信頼度が低い or 適合なしのとき null */
  accountCode: string | null;
  confidence: 'high' | 'low' | 'none';
  reason?: string;
}
// 在庫運用が無い帳簿では売上原価が成立せず、これらは対方になり得ない
const INVENTORY_ACCOUNT_CODES = ['1340', '5010', '5020', '5030'];
// 対方候補の絞り込み：事業所得のみ・既知科目を除外・既知側の性質に応じたカテゴリ・在庫運用の有無
export function counterpartCandidates(
  accounts: Account[],
  knownAccountCode: string,
  knownSide: 'debit' | 'credit',
  inventoryLive: boolean,
): Account[] {
  const known = accounts.find((a) => a.code === knownAccountCode);
  const categories = counterpartCategories(known?.category, knownSide);
  return accounts.filter(
    (a) =>
      (a.incomeType ?? 'business') === 'business' &&
      a.code !== knownAccountCode &&
      categories.includes(a.category) &&
      (inventoryLive || !INVENTORY_ACCOUNT_CODES.includes(a.code)),
  );
}
// 負債（未払金等）は借方・貸方どちらも対方は費用/資産：貸方＝計上、借方＝取消（戻し）や返済
function counterpartCategories(
  knownCategory: AccountCategory | undefined,
  knownSide: 'debit' | 'credit',
): AccountCategory[] {
  if (knownCategory === 'liability') {
    return ['expense', 'asset'];
  }
  if (knownCategory === 'asset' && knownSide === 'debit') {
    return ['revenue', 'asset'];
  }
  if (knownCategory === 'asset' && knownSide === 'credit') {
    return ['expense', 'asset'];
  }
  return knownSide === 'debit' ? ['revenue', 'asset'] : ['expense', 'asset'];
}

interface ClassifyOptions {
  knownAccountCode: string;
  knownSide: 'debit' | 'credit';
  /** UI から候補に提示する科目（カテゴリ別に絞り込み済を推奨） */
  candidateAccounts: Account[];
}
// LLM で 1 ファイル分のトランザクション群を一括分類する。
// 既存の rule engine と組み合わせて、rule で hit しなかった行のみ LLM に投げる用途を想定。
export async function classifyWithLlm(
  adapter: LlmAdapter,
  inputs: ClassifyInput[],
  options: ClassifyOptions,
): Promise<ClassifySuggestion[]> {
  if (inputs.length === 0) {
    return [];
  }
  const raw = adapter.runDataTask
    ? await adapter.runDataTask('classify', buildClassifyData(inputs, options))
    : await adapter.generateJson(buildPrompt(inputs, options));
  return parseResponse(raw, inputs, options.candidateAccounts);
}
// データだけを渡す端末内経路用のペイロード。buildPrompt と違い会計コンテキストの説明文は
// 持たない（指示は実装側に固定で埋め込まれているため、ここではデータだけを渡す）。
function buildClassifyData(inputs: ClassifyInput[], options: ClassifyOptions) {
  return {
    knownAccountCode: options.knownAccountCode,
    knownSide: options.knownSide,
    candidates: options.candidateAccounts.map((a) => ({
      code: a.code,
      name: a.name,
      category: a.category,
    })),
    transactions: inputs.map((t) => ({ ref: t.ref, description: t.description, amount: t.amount })),
  };
}
// プロンプト生成：日本語で会計コンテキストを明示し、JSON 出力を要求する
export function buildPrompt(inputs: ClassifyInput[], options: ClassifyOptions): string {
  const knownSideJa = options.knownSide === 'debit' ? '借方' : '貸方';
  const counterpartSideJa = options.knownSide === 'debit' ? '貸方' : '借方';
  const candidateList = options.candidateAccounts
    .map((a) => `- ${a.code} ${a.name}（${categoryLabel(a.category)}）`)
    .join('\n');

  const txList = inputs
    .map(
      (t) => `[ref="${escapeJson(t.ref)}", 摘要="${escapeJson(t.description)}", 金額=${t.amount}]`,
    )
    .join('\n');

  return [
    `あなたは日本の個人事業主向け会計補助 AI です。`,
    `以下の CSV 由来トランザクションについて、適切な「対方科目」を分類してください。`,
    ``,
    `既知側：${options.knownAccountCode}（${knownSideJa}）`,
    `求められる側：${counterpartSideJa}`,
    ``,
    `候補となる科目（必ずこの一覧の code を使うこと）：`,
    candidateList,
    ``,
    `トランザクション：`,
    txList,
    ``,
    `各行について以下の JSON オブジェクトを classifications 配列に格納して返答すること：`,
    `  - ref: 入力の ref をそのまま`,
    `  - accountCode: 候補一覧の code、確度が低いまたは判別不能のとき null`,
    `  - confidence: "high" / "low" / "none"`,
    `  - reason: 簡潔な日本語の判断理由（30 字以内）`,
    ``,
    `レスポンスは { "classifications": [...] } の形のみとし、他のテキストは含めないこと。`,
  ].join('\n');
}

function parseResponse(
  raw: unknown,
  inputs: ClassifyInput[],
  candidates: Account[],
): ClassifySuggestion[] {
  if (!raw || typeof raw !== 'object' || !('classifications' in raw)) {
    throw new LlmError(m.error_classify_response_shape());
  }
  const list = (raw as { classifications: unknown }).classifications;
  if (!Array.isArray(list)) {
    throw new LlmError(m.error_classify_not_array());
  }

  const codeSet = new Set(candidates.map((a) => a.code));
  const byRef = new Map<string, ClassifySuggestion>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const r = raw as Record<string, unknown>;
    const ref = typeof r.ref === 'string' ? r.ref : null;
    if (!ref) {
      continue;
    }
    const accountCode =
      typeof r.accountCode === 'string' && codeSet.has(r.accountCode) ? r.accountCode : null;
    let confidence: ClassifySuggestion['confidence'] = 'none';
    if (r.confidence === 'high' && accountCode) {
      confidence = 'high';
    } else if (r.confidence === 'low' && accountCode) {
      confidence = 'low';
    }
    const result: ClassifySuggestion = {
      ref,
      accountCode,
      confidence,
    };
    if (typeof r.reason === 'string' && r.reason.length > 0) {
      result.reason = r.reason;
    }
    byRef.set(ref, result);
  }
  // 入力順に並べて返す。レスポンスに含まれない ref は confidence 'none' で補完
  return inputs.map(
    (t) =>
      byRef.get(t.ref) ?? {
        ref: t.ref,
        accountCode: null,
        confidence: 'none' as const,
      },
  );
}

function categoryLabel(c: AccountCategory): string {
  return (
    {
      asset: '資産',
      liability: '負債',
      equity: '純資産',
      revenue: '収益',
      expense: '費用',
    } as const
  )[c];
}

function escapeJson(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
