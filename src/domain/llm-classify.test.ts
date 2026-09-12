import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildPrompt,
  classifyWithLlm,
  counterpartCandidates,
  type ClassifyInput,
} from './llm-classify';
import type { LlmAdapter } from './llm';
import type { Account } from '../db/types';
import { AppleAiAdapter } from '../lib/apple-ai-adapter';
import { shouldFillSuggestion } from '../routes/Import.svelte';

const ACCOUNTS: Account[] = [
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 200 },
];

const CANDIDATE_ACCOUNTS: Account[] = [
  { code: '2120', year: 2026, name: '未払金', category: 'liability', displayOrder: 120 },
  { code: '1130', year: 2026, name: '普通預金', category: 'asset', displayOrder: 130 },
  { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 110 },
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 200 },
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  {
    code: '5210',
    year: 2026,
    name: '不動産管理費',
    category: 'expense',
    incomeType: 'realEstate',
    displayOrder: 210,
  },
  {
    code: '4210',
    year: 2026,
    name: '賃貸料収入',
    category: 'revenue',
    incomeType: 'realEstate',
    displayOrder: 210,
  },
];

function fakeAdapter(response: unknown): LlmAdapter {
  return {
    external: false,
    destinationHost: '',
    generateJson: async () => response,
  };
}

describe('buildPrompt', () => {
  test('includes candidate accounts with names', () => {
    const p = buildPrompt([{ ref: 'r1', description: 'amazon', amount: '2500' }], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(p).toContain('5200 消耗品費');
    expect(p).toContain('4110 売上高');
  });

  test('describes known side correctly', () => {
    const p = buildPrompt([], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(p).toContain('1130（貸方）');
    expect(p).toContain('求められる側：借方');
  });

  test('escapes embedded quotes in descriptions', () => {
    const p = buildPrompt([{ ref: 'r1', description: 'He said "hi"', amount: '100' }], {
      knownAccountCode: '1130',
      knownSide: 'debit',
      candidateAccounts: ACCOUNTS,
    });
    expect(p).toContain('He said \\"hi\\"');
  });
});

describe('classifyWithLlm', () => {
  const inputs: ClassifyInput[] = [
    { ref: 'r1', description: 'amazon', amount: '2500' },
    { ref: 'r2', description: 'クライアント振込', amount: '100000' },
    { ref: 'r3', description: '謎の文字列', amount: '500' },
  ];

  test('maps response to inputs by ref', async () => {
    const adapter = fakeAdapter({
      classifications: [
        { ref: 'r1', accountCode: '5200', confidence: 'high', reason: 'EC' },
        { ref: 'r2', accountCode: '4110', confidence: 'high' },
        { ref: 'r3', accountCode: null, confidence: 'none' },
      ],
    });
    const r = await classifyWithLlm(adapter, inputs, {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r).toHaveLength(3);
    expect(r[0]?.accountCode).toBe('5200');
    expect(r[0]?.confidence).toBe('high');
    expect(r[1]?.accountCode).toBe('4110');
    expect(r[2]?.accountCode).toBe(null);
    expect(r[2]?.confidence).toBe('none');
  });

  test('treats unknown accountCode in response as null', async () => {
    const adapter = fakeAdapter({
      classifications: [{ ref: 'r1', accountCode: '9999', confidence: 'high' }],
    });
    const r = await classifyWithLlm(adapter, [inputs[0]!], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r[0]?.accountCode).toBe(null);
    expect(r[0]?.confidence).toBe('none');
  });

  test('fills missing refs with none confidence', async () => {
    const adapter = fakeAdapter({
      classifications: [{ ref: 'r1', accountCode: '5200', confidence: 'high' }],
    });
    const r = await classifyWithLlm(adapter, inputs, {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r).toHaveLength(3);
    expect(r[0]?.confidence).toBe('high');
    expect(r[1]?.confidence).toBe('none');
    expect(r[2]?.confidence).toBe('none');
  });

  test('throws on malformed response', async () => {
    const adapter = fakeAdapter({ wrong: 'shape' });
    await expect(
      classifyWithLlm(adapter, inputs, {
        knownAccountCode: '1130',
        knownSide: 'credit',
        candidateAccounts: ACCOUNTS,
      }),
    ).rejects.toThrow(/classifications/);
  });

  test('returns empty array for empty input without calling adapter', async () => {
    let called = false;
    const adapter: LlmAdapter = {
      external: false,
      destinationHost: '',
      generateJson: async () => {
        called = true;
        return { classifications: [] };
      },
    };
    const r = await classifyWithLlm(adapter, [], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r).toEqual([]);
    expect(called).toBe(false);
  });
});
// runDataTask を持つアダプター（apple-ai）経由の分類。プロンプトではなくデータを渡し、
// Swift 側の @Generable が返す形の JSON（classifications 配列、accountCode は非対応時は空文字）
// を受け取る経路。
describe('classifyWithLlm（AppleAiAdapter 経由）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('アダプターが送るバイト列と Swift 側が返す JSON の形で相手科目が反映される', async () => {
    const appleAiRun = vi.fn(async (task: number, data: string) => {
      expect(task).toBe(1);
      expect(JSON.parse(data)).toEqual({
        knownAccountCode: '1130',
        knownSide: 'credit',
        candidates: [
          { code: '4110', name: '売上高', category: 'revenue' },
          { code: '5150', name: '通信費', category: 'expense' },
          { code: '5200', name: '消耗品費', category: 'expense' },
        ],
        transactions: [{ ref: 'r1', description: 'amazon', amount: '2500' }],
      });
      // JSONEncoder(.withoutEscapingSlashes) が返す形。accountCode 非対応時は空文字。
      return JSON.stringify({
        classifications: [
          { ref: 'r1', accountCode: '5200', confidence: 'high', reason: 'EC サイト' },
        ],
      });
    });
    vi.stubGlobal('window', { __aoikoNative: { appleAiRun } });

    const r = await classifyWithLlm(
      new AppleAiAdapter(),
      [{ ref: 'r1', description: 'amazon', amount: '2500' }],
      { knownAccountCode: '1130', knownSide: 'credit', candidateAccounts: ACCOUNTS },
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.accountCode).toBe('5200');
    expect(r[0]?.confidence).toBe('high');
  });
});
// 相方：scripts/swift/ClassifyLoopTests.swift の testUnmatchedAndFailedEnvelopesArePinned が
// この文字列を encodeClassifyLoopEnvelope の出力として確定させる（一文字違えばどちらかが赤くなる）。
describe('classifyWithLlm（failed マーカーの伝播）', () => {
  const FAILED_ENVELOPE =
    '{"classifications":[{"accountCode":"","confidence":"none","reason":"","ref":"r1","status":"failed"}]}';

  test('failed 行は confidence none・failed true になり、shouldFillSuggestion は false', async () => {
    const adapter: LlmAdapter = {
      external: false,
      destinationHost: '',
      generateJson: async () => {
        throw new Error('runDataTask を使う経路のテストで generateJson は呼ばれないはず');
      },
      runDataTask: async () => JSON.parse(FAILED_ENVELOPE) as unknown,
    };
    const r = await classifyWithLlm(adapter, [{ ref: 'r1', description: 'd', amount: '1' }], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.accountCode).toBe(null);
    expect(r[0]?.confidence).toBe('none');
    expect(r[0]?.failed).toBe(true);
    expect(shouldFillSuggestion(r[0]!)).toBe(false);
  });

  test('failed 行に accountCode/confidence high が同梱されていても none 扱いで auto-fill されない', async () => {
    const adapter: LlmAdapter = {
      external: false,
      destinationHost: '',
      generateJson: async () => {
        throw new Error('runDataTask を使う経路のテストで generateJson は呼ばれないはず');
      },
      runDataTask: async () => ({
        classifications: [{ ref: 'r1', accountCode: '5200', confidence: 'high', status: 'failed' }],
      }),
    };
    const r = await classifyWithLlm(adapter, [{ ref: 'r1', description: 'd', amount: '1' }], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r[0]?.accountCode).toBe(null);
    expect(r[0]?.confidence).toBe('none');
    expect(r[0]?.failed).toBe(true);
    expect(shouldFillSuggestion(r[0]!)).toBe(false);
  });

  test('status が unmatched の行は failed が立たない', async () => {
    const adapter: LlmAdapter = {
      external: false,
      destinationHost: '',
      generateJson: async () => {
        throw new Error('runDataTask を使う経路のテストで generateJson は呼ばれないはず');
      },
      runDataTask: async () => ({
        classifications: [
          { ref: 'r1', accountCode: '', confidence: 'none', reason: '', status: 'unmatched' },
        ],
      }),
    };
    const r = await classifyWithLlm(adapter, [{ ref: 'r1', description: 'd', amount: '1' }], {
      knownAccountCode: '1130',
      knownSide: 'credit',
      candidateAccounts: ACCOUNTS,
    });
    expect(r[0]?.failed).toBeUndefined();
  });
});

describe('counterpartCandidates', () => {
  test('liability known, credit side: expense/asset, no revenue, no realEstate', () => {
    const r = counterpartCandidates(CANDIDATE_ACCOUNTS, '2120', 'credit', true);
    const codes = r.map((a) => a.code);
    expect(codes).toContain('5200');
    expect(codes).toContain('1110');
    expect(r.some((a) => a.incomeType === 'realEstate')).toBe(false);
    expect(r.some((a) => a.category === 'revenue')).toBe(false);
  });

  test('liability known, debit side (refund/repayment): expense/asset, no revenue, no realEstate', () => {
    const r = counterpartCandidates(CANDIDATE_ACCOUNTS, '2120', 'debit', true);
    const codes = r.map((a) => a.code);
    expect(codes).toContain('5200');
    expect(codes).toContain('1110');
    expect(r.some((a) => a.category === 'revenue')).toBe(false);
    expect(r.some((a) => a.incomeType === 'realEstate')).toBe(false);
  });

  test('asset known, debit side (deposit): revenue/asset, excludes self, no expense', () => {
    const r = counterpartCandidates(CANDIDATE_ACCOUNTS, '1130', 'debit', true);
    const codes = r.map((a) => a.code);
    expect(codes).not.toContain('1130');
    expect(codes).toContain('4110');
    expect(codes).toContain('1110');
    expect(r.some((a) => a.category === 'expense')).toBe(false);
  });

  test('asset known, credit side (withdrawal): expense/asset, excludes self, no revenue', () => {
    const r = counterpartCandidates(CANDIDATE_ACCOUNTS, '1130', 'credit', true);
    const codes = r.map((a) => a.code);
    expect(codes).not.toContain('1130');
    expect(codes).toContain('5200');
    expect(r.some((a) => a.category === 'revenue')).toBe(false);
  });

  test('unknown known code, debit side: falls back to side-only rule', () => {
    const r = counterpartCandidates(CANDIDATE_ACCOUNTS, '9999', 'debit', true);
    const codes = r.map((a) => a.code);
    expect(r.length).toBeGreaterThan(0);
    expect(codes).toContain('4110');
    expect(codes).toContain('1110');
    expect(r.some((a) => a.incomeType === 'realEstate')).toBe(false);
    expect(r.some((a) => a.category === 'expense')).toBe(false);
  });
});

const INVENTORY_ACCOUNTS: Account[] = [
  { code: '1340', year: 2026, name: '棚卸資産', category: 'asset', displayOrder: 340 },
  { code: '5010', year: 2026, name: '期首商品棚卸高', category: 'expense', displayOrder: 10 },
  { code: '5020', year: 2026, name: '仕入', category: 'expense', displayOrder: 20 },
  { code: '5030', year: 2026, name: '期末商品棚卸高', category: 'expense', displayOrder: 30 },
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 200 },
  { code: '1110', year: 2026, name: '現金', category: 'asset', displayOrder: 110 },
  { code: '2120', year: 2026, name: '未払金', category: 'liability', displayOrder: 120 },
];

describe('counterpartCandidates（在庫運用の有無）', () => {
  test('在庫運用ありなら 1340/5010/5020/5030 を含む（従来通り）', () => {
    const r = counterpartCandidates(INVENTORY_ACCOUNTS, '2120', 'credit', true);
    const codes = r.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['1340', '5010', '5020', '5030', '5200', '1110']));
  });

  test('在庫運用なしなら 1340/5010/5020/5030 を除外し、5200/1110 は残す', () => {
    const r = counterpartCandidates(INVENTORY_ACCOUNTS, '2120', 'credit', false);
    const codes = r.map((a) => a.code);
    expect(codes).not.toContain('1340');
    expect(codes).not.toContain('5010');
    expect(codes).not.toContain('5020');
    expect(codes).not.toContain('5030');
    expect(codes).toContain('5200');
    expect(codes).toContain('1110');
  });

  test('同一科目・同一側で差分は在庫 4 科目のみ', () => {
    const withInventory = counterpartCandidates(INVENTORY_ACCOUNTS, '2120', 'credit', true);
    const withoutInventory = counterpartCandidates(INVENTORY_ACCOUNTS, '2120', 'credit', false);
    const diff = withInventory
      .map((a) => a.code)
      .filter((c) => !withoutInventory.some((a) => a.code === c));
    expect(diff.sort()).toEqual(['1340', '5010', '5020', '5030']);
  });
});
