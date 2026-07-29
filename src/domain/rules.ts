import { db } from '../db/db';
import type { ParserRule } from '../db/types';
// priority 降順で全ルールを読み込む。行ごとに呼ばず、ファイル処理の開始時に一度だけ読む。
export async function loadRules(): Promise<ParserRule[]> {
  return db.parserRules.orderBy('priority').reverse().toArray();
}

// 読み込み済みルールから、取引内容（CSV 行の description）に最初にヒットしたルールを返す。
export function findMatchingRule(rules: ParserRule[], description: string): ParserRule | null {
  for (const rule of rules) {
    if (matchRule(rule, description)) {
      return rule;
    }
  }
  return null;
}

export function matchRule(rule: ParserRule, text: string): boolean {
  switch (rule.matchType) {
    case 'description-includes':
      return text.toLowerCase().includes(rule.pattern.toLowerCase());
    case 'vendor-name':
      return text.includes(rule.pattern);
    case 'regex':
      try {
        return new RegExp(rule.pattern).test(text);
      } catch {
        return false;
      }
  }
}

export async function recordRuleHit(ruleId: string): Promise<void> {
  const rule = await db.parserRules.get(ruleId);
  if (!rule) {
    return;
  }
  await db.parserRules.update(ruleId, {
    hitCount: rule.hitCount + 1,
    lastHitAt: Date.now(),
  });
}
