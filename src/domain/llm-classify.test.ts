import { describe, expect, test } from 'vitest';
import { buildPrompt, classifyWithLlm, type ClassifyInput } from './llm-classify';
import type { LlmAdapter } from './llm';
import type { Account } from '../db/types';

const ACCOUNTS: Account[] = [
  { code: '4110', year: 2026, name: '売上高', category: 'revenue', displayOrder: 110 },
  { code: '5150', year: 2026, name: '通信費', category: 'expense', displayOrder: 150 },
  { code: '5200', year: 2026, name: '消耗品費', category: 'expense', displayOrder: 200 },
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
