import { db } from '../db/db';
import type { ParserRule } from '../db/types';
// 取引内容（CSV 行の description）と既存ルールをマッチング、最初にヒットしたルールを返す。
// ルールは priority 降順で評価される。
export async function findMatchingRule(
  description: string
): Promise<ParserRule | null> {
  const rules = await db.parserRules
    .orderBy('priority')
    .reverse()
    .toArray();
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