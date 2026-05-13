import type { Account, AccountCategory } from '../db/types';
import { LlmError, type LlmAdapter } from './llm';

export interface ClassifyInput {
  /** 並び順識別。レスポンスとの対応を保証するために必須 */
  ref: string;
  description: string;
  amount: string;
}

export interface ClassifySuggestion {
  ref: string;
  /** 提案された対方科目 code、信頼度が低い or 適合なしのとき null */
  accountCode: string | null;
  confidence: 'high' | 'low' | 'none';
  reason?: string;
}

export interface ClassifyOptions {
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
  options: ClassifyOptions
): Promise<ClassifySuggestion[]> {
  if (inputs.length === 0) {
    return [];
  }
  const prompt = buildPrompt(inputs, options);
  const raw = await adapter.generateJson(prompt);
  return parseResponse(raw, inputs, options.candidateAccounts);
}
// プロンプト生成：日本語で会計コンテキストを明示し、JSON 出力を要求する
export function buildPrompt(
  inputs: ClassifyInput[],
  options: ClassifyOptions
): string {
  const knownSideJa = options.knownSide === 'debit' ? '借方' : '貸方';
  const counterpartSideJa = options.knownSide === 'debit' ? '貸方' : '借方';
  const candidateList = options.candidateAccounts
    .map((a) => `- ${a.code} ${a.name}（${categoryLabel(a.category)}）`)
    .join('\n');

  const txList = inputs
    .map(
      (t) => `[ref="${escapeJson(t.ref)}", 摘要="${escapeJson(t.description)}", 金額=${t.amount}]`
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
  candidates: Account[]
): ClassifySuggestion[] {
  if (!raw || typeof raw !== 'object' || !('classifications' in raw)) {
    throw new LlmError('レスポンス形式が想定外（classifications がない）');
  }
  const list = (raw as { classifications: unknown }).classifications;
  if (!Array.isArray(list)) {
    throw new LlmError('classifications が配列ではありません');
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
      typeof r.accountCode === 'string' && codeSet.has(r.accountCode)
        ? r.accountCode
        : null;
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
      }
  );
}

function categoryLabel(c: AccountCategory): string {
  return ({
    asset: '資産',
    liability: '負債',
    equity: '純資産',
    revenue: '収益',
    expense: '費用',
  } as const)[c];
}

function escapeJson(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}