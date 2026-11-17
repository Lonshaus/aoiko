import { describe, expect, test } from 'vitest';
import { D } from '../../lib/decimal';
import {
  basicDeduction,
  computeIncomeDeductions,
  computeIncomeTax,
  defenseSurtax,
  dependentDeductions,
  donationDeduction,
  earthquakeInsuranceDeduction,
  filingTaxDue,
  lifeInsuranceDeduction,
  medicalExpenseDeduction,
  progressiveIncomeTax,
  reconstructionSurtax,
  relativeDisabilityDeduction,
  salaryAdjustmentEligibility,
  spouseDeduction,
  totalTaxCredits,
  workingStudentDeduction,
  singleParentOrWidowDeduction,
  disabilityDeduction,
  type IncomeDeductionInput,
} from './income-deductions';

describe('basicDeduction', () => {
  test('令和7年分：132万円以下は95万円', () => {
    expect(basicDeduction(2025, D(1_320_000)).toString()).toBe('950000');
  });

  test('令和7年分：336万円超489万円以下は68万円', () => {
    expect(basicDeduction(2025, D(4_000_000)).toString()).toBe('680000');
  });

  test('令和7年分：655万円超2,350万円以下は58万円', () => {
    expect(basicDeduction(2025, D(10_000_000)).toString()).toBe('580000');
  });

  test('令和7年分：2,350万円超は高所得者逓減表', () => {
    expect(basicDeduction(2025, D(24_200_000)).toString()).toBe('320000');
    expect(basicDeduction(2025, D(25_100_000)).toString()).toBe('0');
  });

  test('令和8年分：489万円ちょうどは104万円、489万円超は67万円', () => {
    expect(basicDeduction(2026, D(4_890_000)).toString()).toBe('1040000');
    expect(basicDeduction(2026, D(4_890_001)).toString()).toBe('670000');
  });

  test('令和8年分：655万円ちょうどは67万円、655万円超は62万円', () => {
    expect(basicDeduction(2026, D(6_550_000)).toString()).toBe('670000');
    expect(basicDeduction(2026, D(6_550_001)).toString()).toBe('620000');
  });

  test('令和8年分：2,350万円ちょうどは62万円、超は高所得者逓減表', () => {
    expect(basicDeduction(2026, D(23_500_000)).toString()).toBe('620000');
    expect(basicDeduction(2026, D(23_500_001)).toString()).toBe('480000');
  });

  test('令和9年分も令和8年分と同じ表', () => {
    expect(basicDeduction(2027, D(4_890_000)).toString()).toBe('1040000');
  });

  test('令和10年分以後：132万円ちょうどは99万円、132万円超は62万円', () => {
    expect(basicDeduction(2028, D(1_320_000)).toString()).toBe('990000');
    expect(basicDeduction(2028, D(1_320_001)).toString()).toBe('620000');
  });

  test('令和10年分以後：2,350万円ちょうどは62万円、超は高所得者逓減表', () => {
    expect(basicDeduction(2028, D(23_500_000)).toString()).toBe('620000');
    expect(basicDeduction(2028, D(23_500_001)).toString()).toBe('480000');
  });
});

describe('lifeInsuranceDeduction', () => {
  test('新制度のみ・各区分の上限4万円、合計上限12万円', () => {
    const amount = lifeInsuranceDeduction({
      newGeneral: D(100_000),
      newMedical: D(100_000),
      newPension: D(100_000),
    });
    expect(amount.toString()).toBe('120000');
  });

  test('旧制度のみ・上限5万円', () => {
    const amount = lifeInsuranceDeduction({ oldGeneral: D(200_000) });
    expect(amount.toString()).toBe('50000');
  });

  test('旧制度のみ・上限未満は計算式どおり', () => {
    const amount = lifeInsuranceDeduction({ oldGeneral: D(60_000) });
    expect(amount.toString()).toBe('40000');
  });
});

describe('earthquakeInsuranceDeduction', () => {
  test('地震保険料は上限5万円', () => {
    expect(earthquakeInsuranceDeduction(D(100_000), D(0)).toString()).toBe('50000');
  });

  test('経過措置（旧長期損害保険）と合算しても合計上限5万円', () => {
    expect(earthquakeInsuranceDeduction(D(50_000), D(30_000)).toString()).toBe('50000');
  });
});

describe('medicalExpenseDeduction', () => {
  test('総所得金額の5%と10万円の低い方を差し引く', () => {
    // 総所得150万円 → 5%=75,000円 < 10万円 → 75,000円を差し引く
    expect(medicalExpenseDeduction(D(200_000), D(0), D(1_500_000)).toString()).toBe('125000');
  });

  test('保険金補填後がマイナスなら控除0', () => {
    expect(medicalExpenseDeduction(D(50_000), D(80_000), D(3_000_000)).toString()).toBe('0');
  });

  test('上限200万円', () => {
    expect(medicalExpenseDeduction(D(3_000_000), D(0), D(10_000_000)).toString()).toBe('2000000');
  });
});

describe('donationDeduction', () => {
  test('寄附金−2,000円', () => {
    expect(donationDeduction(D(50_000), D(5_000_000)).toString()).toBe('48000');
  });

  test('総所得金額の40%が上限', () => {
    expect(donationDeduction(D(2_000_000), D(1_000_000)).toString()).toBe('398000');
  });
});

describe('spouseDeduction', () => {
  test('配偶者所得58万円以下・納税者900万円以下は38万円（一般）', () => {
    expect(
      spouseDeduction(2026, D(5_000_000), { totalIncome: D(500_000), age: 40 }).toString(),
    ).toBe('380000');
  });

  test('老人控除対象配偶者（70歳以上）は48万円', () => {
    expect(
      spouseDeduction(2026, D(5_000_000), { totalIncome: D(500_000), age: 72 }).toString(),
    ).toBe('480000');
  });

  test('配偶者特別控除：所得95万円以下は38万円', () => {
    expect(
      spouseDeduction(2026, D(5_000_000), { totalIncome: D(900_000), age: 40 }).toString(),
    ).toBe('380000');
  });

  test('配偶者特別控除：所得133万円超は控除なし', () => {
    expect(
      spouseDeduction(2026, D(5_000_000), { totalIncome: D(1_400_000), age: 40 }).toString(),
    ).toBe('0');
  });

  test('納税者本人の合計所得金額1,000万円超は控除なし', () => {
    expect(
      spouseDeduction(2026, D(10_100_000), { totalIncome: D(500_000), age: 40 }).toString(),
    ).toBe('0');
  });

  test('配偶者なしは0', () => {
    expect(spouseDeduction(2026, D(5_000_000), undefined).toString()).toBe('0');
  });
  // 所得58万円超62万円以下の配偶者は、令和7年分では配偶者特別控除、令和8年分では
  // 配偶者控除の対象になる。適用される条文は変わるが、この帯では控除額はどちらも38万円。
  test('扶養親族等の所得要件の境界：所得58万円超62万円以下の配偶者は年分を問わず38万円', () => {
    expect(
      spouseDeduction(2025, D(5_000_000), { totalIncome: D(600_000), age: 40 }).toString(),
    ).toBe('380000');
    expect(
      spouseDeduction(2026, D(5_000_000), { totalIncome: D(600_000), age: 40 }).toString(),
    ).toBe('380000');
  });
});

describe('dependentDeductions', () => {
  test('一般扶養親族（16〜18歳・23〜69歳）は38万円', () => {
    const { dependentDeduction } = dependentDeductions(2026, [
      { id: '1', age: 17, totalIncome: D(0) },
    ]);
    expect(dependentDeduction.toString()).toBe('380000');
  });
  // 配偶者と違い扶養親族には所得要件を超えた場合の特別控除が無いため、この帯では
  // 令和7年分は控除ゼロ、令和8年分は満額になる。所得要件引上げの実質的な効果はここに出る。
  test('扶養親族等の所得要件の境界：所得58万円超62万円以下は令和8年分のみ扶養控除の対象', () => {
    expect(
      dependentDeductions(2025, [
        { id: '1', age: 17, totalIncome: D(600_000) },
      ]).dependentDeduction.toString(),
    ).toBe('0');
    expect(
      dependentDeductions(2026, [
        { id: '1', age: 17, totalIncome: D(600_000) },
      ]).dependentDeduction.toString(),
    ).toBe('380000');
  });

  test('特定扶養親族（19〜22歳、扶養親族等の所得要件以下）は63万円', () => {
    const { dependentDeduction } = dependentDeductions(2026, [
      { id: '1', age: 20, totalIncome: D(300_000) },
    ]);
    expect(dependentDeduction.toString()).toBe('630000');
  });

  test('老人扶養親族：同居老親等は58万円、一般は48万円', () => {
    const { dependentDeduction } = dependentDeductions(2026, [
      { id: '1', age: 75, totalIncome: D(0), livesWithLinealAscendant: true },
      { id: '2', age: 75, totalIncome: D(0) },
    ]);
    expect(dependentDeduction.toString()).toBe('1060000');
  });

  test('16歳未満（年少扶養親族）は控除なし', () => {
    const { dependentDeduction } = dependentDeductions(2026, [
      { id: '1', age: 10, totalIncome: D(0) },
    ]);
    expect(dependentDeduction.toString()).toBe('0');
  });

  test('19〜22歳で所得要件超123万円以下は扶養控除ではなく特定親族特別控除', () => {
    const { dependentDeduction, specificRelativeSpecialDeduction } = dependentDeductions(2026, [
      { id: '1', age: 20, totalIncome: D(900_000) },
    ]);
    expect(dependentDeduction.toString()).toBe('0');
    expect(specificRelativeSpecialDeduction.toString()).toBe('610000');
  });

  test('19〜22歳で所得123万円超は控除なし', () => {
    const { dependentDeduction, specificRelativeSpecialDeduction } = dependentDeductions(2026, [
      { id: '1', age: 20, totalIncome: D(1_300_000) },
    ]);
    expect(dependentDeduction.toString()).toBe('0');
    expect(specificRelativeSpecialDeduction.toString()).toBe('0');
  });

  test('扶養親族等の所得要件の境界：所得58万円超62万円以下は令和8年分のみ扶養控除の対象', () => {
    const reiwa7 = dependentDeductions(2025, [{ id: '1', age: 30, totalIncome: D(600_000) }]);
    expect(reiwa7.dependentDeduction.toString()).toBe('0');
    const reiwa8 = dependentDeductions(2026, [{ id: '1', age: 30, totalIncome: D(600_000) }]);
    expect(reiwa8.dependentDeduction.toString()).toBe('380000');
  });
});

describe('その他の単純控除', () => {
  test('勤労学生控除27万円', () => {
    expect(workingStudentDeduction(true).toString()).toBe('270000');
    expect(workingStudentDeduction(false).toString()).toBe('0');
  });

  test('寡婦控除27万円・ひとり親控除35万円（令和8年分）はいずれか一方', () => {
    expect(singleParentOrWidowDeduction(2026, true, true).toString()).toBe('350000');
    expect(singleParentOrWidowDeduction(2026, false, true).toString()).toBe('270000');
    expect(singleParentOrWidowDeduction(2026, false, false).toString()).toBe('0');
  });

  test('ひとり親控除は令和9年分以後38万円、寡婦控除は据え置き', () => {
    expect(singleParentOrWidowDeduction(2027, true, false).toString()).toBe('380000');
    expect(singleParentOrWidowDeduction(2027, false, true).toString()).toBe('270000');
  });

  test('障害者控除27万円・特別障害者控除40万円', () => {
    expect(disabilityDeduction({ isDisabled: true, isSpecialDisabled: false }).toString()).toBe(
      '270000',
    );
    expect(disabilityDeduction({ isDisabled: false, isSpecialDisabled: true }).toString()).toBe(
      '400000',
    );
  });
});

describe('computeIncomeDeductions', () => {
  test('全項目を合算した total を返す', () => {
    const input: IncomeDeductionInput = {
      totalIncome: D(3_000_000),
      socialInsurancePaid: D(400_000),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: false,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      dependents: [],
    };
    const result = computeIncomeDeductions(2026, input);
    // 基礎控除104万円（489万円以下） + 社会保険料控除40万円
    expect(result.total.toString()).toBe('1440000');
  });
});

describe('totalTaxCredits', () => {
  test('未入力項目は0として合算', () => {
    expect(totalTaxCredits({ dividendDeductionAmount: D(10_000) }).toString()).toBe('10000');
  });
});

describe('progressiveIncomeTax', () => {
  test('195万円未満は5%', () => {
    expect(progressiveIncomeTax(D(1_000_000)).toString()).toBe('50000');
  });

  test('330万円超695万円以下は20%・控除427,500円', () => {
    expect(progressiveIncomeTax(D(4_000_000)).toString()).toBe('372500');
  });

  test('1,000円未満は切り捨ててから計算', () => {
    expect(progressiveIncomeTax(D(1_000_999)).toString()).toBe(
      progressiveIncomeTax(D(1_000_000)).toString(),
    );
  });

  test('所得0以下は税額0', () => {
    expect(progressiveIncomeTax(D(0)).toString()).toBe('0');
  });
});

describe('reconstructionSurtax', () => {
  test('令和8年分以前は基準所得税額×2.1%（1円未満切捨て）', () => {
    expect(reconstructionSurtax(2026, D(100_000)).toString()).toBe('2100');
    expect(reconstructionSurtax(2026, D(333)).toString()).toBe('6');
  });

  test('令和9年分以降は基準所得税額×1.1%（1円未満切捨て）', () => {
    expect(reconstructionSurtax(2027, D(100_000)).toString()).toBe('1100');
    expect(reconstructionSurtax(2027, D(350_500)).toString()).toBe('3855');
    expect(reconstructionSurtax(2028, D(333)).toString()).toBe('3');
  });

  test('2026 と 2027 で率が切り替わる', () => {
    expect(reconstructionSurtax(2026, D(1_000_000)).toString()).toBe('21000');
    expect(reconstructionSurtax(2027, D(1_000_000)).toString()).toBe('11000');
  });
});

describe('defenseSurtax', () => {
  test('令和8年分以前は課されない', () => {
    expect(defenseSurtax(2025, D(350_500)).toString()).toBe('0');
    expect(defenseSurtax(2026, D(350_500)).toString()).toBe('0');
  });

  test('令和9年分以降は基準所得税額×1%（1円未満切捨て）', () => {
    expect(defenseSurtax(2027, D(350_500)).toString()).toBe('3505');
    expect(defenseSurtax(2027, D(100_050)).toString()).toBe('1000');
    expect(defenseSurtax(2028, D(99)).toString()).toBe('0');
  });
});

describe('filingTaxDue', () => {
  test('納付：100円未満を切り捨てる', () => {
    expect(filingTaxDue(D(1_296_777)).toString()).toBe('1296700');
    expect(filingTaxDue(D(99)).toString()).toBe('0');
  });

  test('納付：ちょうど100円の倍数はそのまま', () => {
    expect(filingTaxDue(D(1_296_700)).toString()).toBe('1296700');
  });

  test('0はそのまま', () => {
    expect(filingTaxDue(D(0)).toString()).toBe('0');
  });

  test('還付（マイナス）は切り捨てない', () => {
    expect(filingTaxDue(D(-12_345)).toString()).toBe('-12345');
  });
});

describe('computeIncomeTax', () => {
  test('税額控除・外国税額控除・災害減免額・源泉徴収税額なし', () => {
    const r = computeIncomeTax(2026, D(4_000_000), {}, D(0));
    expect(r.incomeTax.toString()).toBe('372500');
    expect(r.diffTax.toString()).toBe('372500');
    expect(r.baseIncomeTax.toString()).toBe('372500');
    // 372,500×2.1%=7,822.5 → 7,822
    expect(r.reconstructionSurtax.toString()).toBe('7822');
    expect(r.defenseSurtax.toString()).toBe('0');
    expect(r.taxTotal.toString()).toBe('380322');
    expect(r.filingTaxDue.toString()).toBe('380300');
  });

  test('外国税額控除は復興特別所得税の算定後、災害減免額は基準所得税額の前に控除する', () => {
    const r = computeIncomeTax(
      2026,
      D(4_000_000),
      {
        mortgageDeductionAmount: D(20_000),
        foreignTaxCreditAmount: D(10_000),
        disasterExemptionAmount: D(2_000),
      },
      D(5_000),
    );
    expect(r.diffTax.toString()).toBe('352500');
    expect(r.baseIncomeTax.toString()).toBe('350500');
    // 350,500×2.1%=7,360.5 → 7,360
    expect(r.reconstructionSurtax.toString()).toBe('7360');
    expect(r.taxTotal.toString()).toBe('357860');
    // 357,860−10,000−5,000=342,860 → 100円未満切捨て
    expect(r.filingTaxDue.toString()).toBe('342800');
  });

  test('税額控除が税額を超えても差引所得税額は0で止まる', () => {
    const r = computeIncomeTax(2026, D(1_000_000), { mortgageDeductionAmount: D(999_999) }, D(0));
    expect(r.diffTax.toString()).toBe('0');
    expect(r.taxTotal.toString()).toBe('0');
  });

  test('源泉徴収税額が上回れば還付（マイナス）で、100円未満も切り捨てない', () => {
    const r = computeIncomeTax(2026, D(1_000_000), {}, D(100_000));
    // 50,000+1,050=51,050 − 100,000
    expect(r.filingTaxDue.toString()).toBe('-48950');
  });
});

describe('computeIncomeTax（令和9年分：防衛特別所得税）', () => {
  const credits = {
    mortgageDeductionAmount: D(20_000),
    foreignTaxCreditAmount: D(10_000),
    disasterExemptionAmount: D(2_000),
  };

  test('基準所得税額350,500：復興3,855・防衛3,505・合計357,860', () => {
    const r = computeIncomeTax(2027, D(4_000_000), credits, D(0));
    expect(r.baseIncomeTax.toString()).toBe('350500');
    expect(r.reconstructionSurtax.toString()).toBe('3855');
    expect(r.defenseSurtax.toString()).toBe('3505');
    expect(r.taxTotal.toString()).toBe('357860');
  });

  test('各税額を別々に切り捨てるため、合計は基準所得税額×2.1%の場合と1円ずれうる', () => {
    // 基準所得税額 100,050：復興 1,100.55→1,100、防衛 1,000.5→1,000
    const other = { otherTaxCreditAmount: D(550) };
    const r2027 = computeIncomeTax(2027, D(1_981_000), other, D(0));
    expect(r2027.baseIncomeTax.toString()).toBe('100050');
    expect(r2027.reconstructionSurtax.toString()).toBe('1100');
    expect(r2027.defenseSurtax.toString()).toBe('1000');
    expect(r2027.taxTotal.toString()).toBe('102150');
    const r2026 = computeIncomeTax(2026, D(1_981_000), other, D(0));
    expect(r2026.reconstructionSurtax.toString()).toBe('2101');
    expect(r2026.taxTotal.toString()).toBe('102151');
  });

  test('申告納税額は三税の合計から外国税額控除・源泉徴収税額を引き、正なら100円未満を切り捨てる', () => {
    // 357,860−10,000−5,000=342,860 → 342,800
    const r = computeIncomeTax(2027, D(4_000_000), credits, D(5_000));
    expect(r.filingTaxDue.toString()).toBe('342800');
  });

  test('負になれば還付で、100円未満も切り捨てない', () => {
    // 357,860−10,000−400,000=−52,140
    const r = computeIncomeTax(2027, D(4_000_000), credits, D(400_000));
    expect(r.filingTaxDue.toString()).toBe('-52140');
  });
});

describe('relativeDisabilityDeduction（同一生計配偶者・扶養親族の障害者控除）', () => {
  const dep = (over: Partial<Parameters<typeof dependentDeductions>[1][number]> = {}) => ({
    id: 'd1',
    age: 40,
    totalIncome: D(0),
    ...over,
  });

  test('配偶者：障害者27万・特別障害者40万・同居特別障害者75万', () => {
    const amount = (disability: 'none' | 'disabled' | 'special' | 'specialCohabiting') =>
      relativeDisabilityDeduction(2026, { totalIncome: D(0), age: 40, disability }, []).toString();
    expect(amount('none')).toBe('0');
    expect(amount('disabled')).toBe('270000');
    expect(amount('special')).toBe('400000');
    expect(amount('specialCohabiting')).toBe('750000');
  });

  test('扶養親族：障害者27万・特別障害者40万・同居特別障害者75万', () => {
    const amount = (disability: 'none' | 'disabled' | 'special' | 'specialCohabiting') =>
      relativeDisabilityDeduction(2026, undefined, [dep({ disability })]).toString();
    expect(amount('none')).toBe('0');
    expect(amount('disabled')).toBe('270000');
    expect(amount('special')).toBe('400000');
    expect(amount('specialCohabiting')).toBe('750000');
  });

  test('障害の区分が未設定なら0円（既存データの結果は変わらない）', () => {
    expect(
      relativeDisabilityDeduction(2026, { totalIncome: D(0), age: 40 }, [dep()]).toString(),
    ).toBe('0');
  });

  test('15歳の特別障害の扶養親族は40万円、同居なら75万円（扶養控除の対象外でも障害者控除は受けられる）', () => {
    expect(
      relativeDisabilityDeduction(2026, undefined, [
        dep({ age: 15, disability: 'special' }),
      ]).toString(),
    ).toBe('400000');
    expect(
      relativeDisabilityDeduction(2026, undefined, [
        dep({ age: 15, disability: 'specialCohabiting' }),
      ]).toString(),
    ).toBe('750000');
  });

  test('所得が扶養親族等の所得要件を超える親族は対象外（20歳・所得70万円）', () => {
    expect(
      relativeDisabilityDeduction(2026, undefined, [
        dep({ age: 20, totalIncome: D(700_000), disability: 'special' }),
      ]).toString(),
    ).toBe('0');
  });

  test('所得要件はちょうど62万円まで（令和8年分）、令和7年分は58万円まで', () => {
    const spouse = (income: number) => ({
      totalIncome: D(income),
      age: 40,
      disability: 'disabled' as const,
    });
    expect(relativeDisabilityDeduction(2026, spouse(620_000), []).toString()).toBe('270000');
    expect(relativeDisabilityDeduction(2026, spouse(620_001), []).toString()).toBe('0');
    expect(relativeDisabilityDeduction(2025, spouse(580_000), []).toString()).toBe('270000');
    expect(relativeDisabilityDeduction(2025, spouse(580_001), []).toString()).toBe('0');
  });

  test('本人所得が1,000万円超で配偶者控除が0でも、配偶者の障害者控除は受けられる', () => {
    const spouse = { totalIncome: D(0), age: 40, disability: 'special' as const };
    expect(spouseDeduction(2026, D(11_000_000), spouse).toString()).toBe('0');
    expect(relativeDisabilityDeduction(2026, spouse, []).toString()).toBe('400000');
  });

  test('配偶者と扶養親族の分を合算し、computeIncomeDeductions の障害者控除に本人分と合わせて入る', () => {
    const result = computeIncomeDeductions(2026, {
      totalIncome: D(3_000_000),
      socialInsurancePaid: D(0),
      smallBusinessMutualAidPaid: D(0),
      lifeInsurance: {},
      earthquakeInsurancePaid: D(0),
      oldLongTermInsurancePaid: D(0),
      medicalExpensePaid: D(0),
      medicalInsuranceReimbursement: D(0),
      donationAmount: D(0),
      casualtyLossDeduction: D(0),
      isDisabled: true,
      isSpecialDisabled: false,
      isSingleParent: false,
      isWidow: false,
      isWorkingStudent: false,
      spouse: { totalIncome: D(0), age: 40, disability: 'disabled' },
      dependents: [
        dep({ disability: 'special' }),
        dep({ id: 'd2', disability: 'specialCohabiting' }),
      ],
    });
    // 本人27万＋配偶者27万＋40万＋75万
    expect(result.disabilityDeduction.toString()).toBe('1690000');
  });
});

describe('salaryAdjustmentEligibility（所得金額調整控除①の要件）', () => {
  const base = { isSpecialDisabled: false, dependents: [] };
  const dep = (age: number, totalIncome: number, disability?: 'special') => ({
    id: `d${age}`,
    age,
    totalIncome: D(totalIncome),
    ...(disability ? { disability } : {}),
  });

  test('何も該当しなければすべて false', () => {
    expect(salaryAdjustmentEligibility(2026, base)).toEqual({
      selfSpecialDisabled: false,
      hasDependentUnder23: false,
      hasSpecialDisabledRelative: false,
    });
  });

  test('本人が特別障害者', () => {
    expect(
      salaryAdjustmentEligibility(2026, { ...base, isSpecialDisabled: true }).selfSpecialDisabled,
    ).toBe(true);
  });

  test('23歳未満の扶養親族：22歳は該当、23歳は非該当、16歳未満も該当', () => {
    const has = (age: number) =>
      salaryAdjustmentEligibility(2026, { ...base, dependents: [dep(age, 0)] }).hasDependentUnder23;
    expect(has(22)).toBe(true);
    expect(has(23)).toBe(false);
    expect(has(3)).toBe(true);
  });

  test('20歳でも所得が要件を超えれば扶養親族ではないので該当しない', () => {
    expect(
      salaryAdjustmentEligibility(2026, { ...base, dependents: [dep(20, 700_000)] })
        .hasDependentUnder23,
    ).toBe(false);
  });

  test('特別障害者である扶養親族・同一生計配偶者（同居特別障害者を含む）', () => {
    expect(
      salaryAdjustmentEligibility(2026, { ...base, dependents: [dep(40, 0, 'special')] })
        .hasSpecialDisabledRelative,
    ).toBe(true);
    expect(
      salaryAdjustmentEligibility(2026, {
        ...base,
        spouse: { totalIncome: D(0), age: 40, disability: 'specialCohabiting' },
      }).hasSpecialDisabledRelative,
    ).toBe(true);
  });

  test('障害者（特別でない）は対象外、所得要件超の特別障害者の配偶者も対象外', () => {
    expect(
      salaryAdjustmentEligibility(2026, {
        ...base,
        spouse: { totalIncome: D(0), age: 40, disability: 'disabled' },
      }).hasSpecialDisabledRelative,
    ).toBe(false);
    expect(
      salaryAdjustmentEligibility(2026, {
        ...base,
        spouse: { totalIncome: D(700_000), age: 40, disability: 'special' },
      }).hasSpecialDisabledRelative,
    ).toBe(false);
  });
});
