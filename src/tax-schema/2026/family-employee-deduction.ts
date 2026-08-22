// 白色申告の事業専従者控除（所法57条3項）。青色申告特別控除後の実額を使う
// 青色事業専従者給与とは別制度で、続柄で決まる定額（配偶者86万円・その他の親族50万円）と
// 「事業所得等の金額（控除前）÷（事業専従者の数＋1）」のいずれか低い金額が、
// 各事業専従者ごとの上限になる（共有プールではなく人ごとの上限）。令和8年分もこの
// 金額に変更は無いが、他の所得控除関数（income-deductions.ts）と同じく年を引数に取る。
//
// 事業専従者は、同じ納税者の配偶者控除・配偶者特別控除・扶養控除・特定親族特別控除の
// 対象と重複できない（所法2条1項33号・34号：これらの控除対象は「事業専従者でない者」に
// 限定される）。この相互排他は familyEmployeeExclusion() で扱い、xtx.ts の
// personalDeductionsToCtx() から一箇所で適用する（IncomeDeductions.svelte の試算プレビューと
// .xtx 出力の両方がこの1関数を経由するため）。

import { D, Decimal } from '../../lib/decimal';
import type { FamilyEmployeeRelation, PersonalDeductionFamilyEmployee } from '../../db/types';

const SPOUSE_FAMILY_EMPLOYEE_DEDUCTION_AMOUNT = 860_000;
const OTHER_FAMILY_EMPLOYEE_DEDUCTION_AMOUNT = 500_000;
// 事業専従者の要件（所法57条3項）：生計を一にする配偶者その他の親族で、年末時点15歳以上、
// かつその年を通じて専ら従事した期間が6か月を超える者。
export function isEligibleFamilyEmployee(employee: PersonalDeductionFamilyEmployee): boolean {
  return employee.age >= 15 && employee.monthsWorked > 6;
}

export function businessFamilyEmployees(
  employees: PersonalDeductionFamilyEmployee[],
): PersonalDeductionFamilyEmployee[] {
  return employees.filter((e) => (e.incomeType ?? 'business') === 'business');
}

export function realEstateFamilyEmployees(
  employees: PersonalDeductionFamilyEmployee[],
): PersonalDeductionFamilyEmployee[] {
  return employees.filter((e) => e.incomeType === 'realEstate');
}

interface FamilyEmployeeDeductionEntry {
  id: string;
  name: string;
  relation: FamilyEmployeeRelation;
  monthsWorked: number;
  amount: Decimal;
}

export interface FamilyEmployeeDeductionResult {
  total: Decimal;
  entries: FamilyEmployeeDeductionEntry[];
}

export function familyEmployeeDeduction(
  year: number,
  preDeductionIncome: Decimal,
  employees: PersonalDeductionFamilyEmployee[],
): FamilyEmployeeDeductionResult {
  const eligible = employees.filter(isEligibleFamilyEmployee);
  if (eligible.length === 0 || preDeductionIncome.lessThanOrEqualTo(0)) {
    return { total: D(0), entries: [] };
  }
  const perPersonCap = preDeductionIncome
    .dividedBy(eligible.length + 1)
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const entries = eligible.map((employee) => {
    const fixedAmount = D(
      employee.relation === 'spouse'
        ? SPOUSE_FAMILY_EMPLOYEE_DEDUCTION_AMOUNT
        : OTHER_FAMILY_EMPLOYEE_DEDUCTION_AMOUNT,
    );
    return {
      id: employee.id,
      name: employee.name,
      relation: employee.relation,
      monthsWorked: employee.monthsWorked,
      amount: Decimal.min(fixedAmount, perPersonCap),
    };
  });
  const total = entries.reduce((sum, entry) => sum.plus(entry.amount), D(0));
  return { total, entries };
}

interface FamilyEmployeeExclusion {
  spouseExcluded: boolean;
  excludedDependentIds: Set<string>;
}
// 事業専従者と同一人物は配偶者控除等の対象になれない（除外は id ではなく氏名一致で判定：
// 配偶者側はデータ上1人のみのため続柄で構造的に判定し、扶養親族側は氏名の完全一致で判定する）。
export function familyEmployeeExclusion(
  employees: PersonalDeductionFamilyEmployee[],
  dependents: Array<{ id: string; name: string }>,
): FamilyEmployeeExclusion {
  const eligible = employees.filter(isEligibleFamilyEmployee);
  const spouseExcluded = eligible.some((e) => e.relation === 'spouse');
  // 氏名未入力どうしが一致して無関係な扶養親族を落とさないよう、空欄は照合対象にしない。
  const employeeNames = new Set(eligible.map((e) => e.name.trim()).filter((n) => n !== ''));
  const excludedDependentIds = new Set(
    dependents.filter((d) => employeeNames.has(d.name.trim())).map((d) => d.id),
  );
  return { spouseExcluded, excludedDependentIds };
}
