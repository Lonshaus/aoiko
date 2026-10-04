import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { db } from '../db/db';
import { newId } from '../lib/id';
import {
  findMatchingRule,
  findVendorByDefaultAccount,
  loadRules,
  matchRule,
  recordRuleHit,
} from './rules';
import type { ParserRule, Vendor } from '../db/types';

function rule(overrides: Partial<ParserRule> = {}): ParserRule {
  return {
    id: newId(),
    matchType: 'description-includes',
    pattern: 'amazon',
    accountCode: '5200',
    priority: 10,
    hitCount: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('matchRule', () => {
  test('description-includes は大文字小文字を区別せずに一致する', () => {
    const r = rule({ matchType: 'description-includes', pattern: 'amazon' });
    expect(matchRule(r, 'AMAZON.CO.JP')).toBe(true);
    expect(matchRule(r, 'amazon prime')).toBe(true);
    expect(matchRule(r, 'rakuten')).toBe(false);
  });

  test('vendor-name は大文字小文字を区別して一致する', () => {
    const r = rule({ matchType: 'vendor-name', pattern: '株式会社東京電力' });
    expect(matchRule(r, '株式会社東京電力')).toBe(true);
    expect(matchRule(r, '東京電力')).toBe(false);
  });

  test('regex は有効なパターンで一致する', () => {
    const r = rule({ matchType: 'regex', pattern: '^AWS' });
    expect(matchRule(r, 'AWS Charge')).toBe(true);
    expect(matchRule(r, 'NotAWS')).toBe(false);
  });

  test('regex のパターンが不正なら安全に false を返す', () => {
    const r = rule({ matchType: 'regex', pattern: '[invalid(' });
    expect(matchRule(r, 'whatever')).toBe(false);
  });
});

describe('findMatchingRule', () => {
  test('指定順で最初に一致したルールを返す', () => {
    const a = rule({ pattern: 'aws', accountCode: '5200' });
    const b = rule({ pattern: 'aws', accountCode: '5150' });
    expect(findMatchingRule([a, b], 'AWS Charge')?.accountCode).toBe('5200');
  });

  test('一致するルールが無ければ null を返す', () => {
    const r = rule({ pattern: 'amazon' });
    expect(findMatchingRule([r], 'rakuten')).toBeNull();
  });

  test('ルールが空なら null を返す', () => {
    expect(findMatchingRule([], 'amazon')).toBeNull();
  });

  test('摘要の一致は大文字小文字を区別しない', () => {
    const r = rule({ pattern: 'Amazon' });
    expect(findMatchingRule([r], 'amazon.co.jp')).not.toBeNull();
  });
});

describe('loadRules', () => {
  test('優先度の順序を最後まで保ち、優先度の高いルールが勝つ', async () => {
    await db.parserRules.add(rule({ pattern: 'aws', accountCode: '5200', priority: 5 }));
    await db.parserRules.add(rule({ pattern: 'aws', accountCode: '5150', priority: 100 }));
    const rules = await loadRules();
    const r = findMatchingRule(rules, 'AWS Charge');
    expect(r?.accountCode).toBe('5150');
  });
});

describe('recordRuleHit', () => {
  test('hitCount を増やし lastHitAt を設定する', async () => {
    const r = rule({ hitCount: 3 });
    await db.parserRules.add(r);
    await recordRuleHit(r.id);
    const updated = await db.parserRules.get(r.id);
    expect(updated?.hitCount).toBe(4);
    expect(updated?.lastHitAt).toBeDefined();
  });

  test('存在しない ID は何もせず無視する', async () => {
    await expect(recordRuleHit('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('findVendorByDefaultAccount', () => {
  const vendor = (name: string, defaultAccountCode?: string): Vendor => ({
    id: newId(),
    name,
    ...(defaultAccountCode ? { defaultAccountCode } : {}),
  });

  test('摘要に名前が含まれ、既定科目を持つ取引先を返す', () => {
    const v = vendor('アマゾン', '5200');
    expect(findVendorByDefaultAccount([v], 'AMZ アマゾン 注文')).toBe(v);
  });

  test('英字の大文字小文字は区別しない', () => {
    const v = vendor('AMAZON', '5200');
    expect(findVendorByDefaultAccount([v], 'Amazon.co.jp 注文')).toBe(v);
  });

  test('既定科目の無い取引先・名前が含まれない取引先は返さない', () => {
    expect(findVendorByDefaultAccount([vendor('アマゾン')], 'アマゾン')).toBeNull();
    expect(findVendorByDefaultAccount([vendor('楽天', '5200')], 'アマゾン')).toBeNull();
  });

  test('名前が空の取引先は無視する', () => {
    expect(findVendorByDefaultAccount([vendor('', '5200')], 'アマゾン')).toBeNull();
  });

  test('複数一致なら名前の長い方を優先する', () => {
    const short = vendor('ヨドバシ', '5200');
    const long = vendor('ヨドバシカメラ', '5210');
    expect(findVendorByDefaultAccount([short, long], 'ヨドバシカメラ 梅田')).toBe(long);
  });
});
