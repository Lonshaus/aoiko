import { describe, expect, test } from 'vitest'
import { D } from '../../lib/decimal'
import {
  otherIncomeAmount,
  otherMiscIncome,
  salaryIncomeAmount,
  salaryIncomeDeduction,
  totalWithholdingTax,
} from './other-income'

describe('salaryIncomeDeduction（令和8・9年分の給与所得控除、220万円以下74万円特例）', () => {
  test('220万円以下は一律74万円', () => {
    expect(salaryIncomeDeduction(D(0)).toString()).toBe('740000')
    expect(salaryIncomeDeduction(D(2_200_000)).toString()).toBe('740000')
  })

  test('220万円超360万円以下は収入×30%+8万円（220万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(D(2_200_001)).toString()).toBe('740000')
    expect(salaryIncomeDeduction(D(3_600_000)).toString()).toBe('1160000')
  })

  test('360万円超660万円以下は収入×20%+44万円（360万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(D(3_600_001)).toString()).toBe('1160000')
    expect(salaryIncomeDeduction(D(6_600_000)).toString()).toBe('1760000')
  })

  test('660万円超850万円以下は収入×10%+110万円（660万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(D(6_600_001)).toString()).toBe('1760000')
    expect(salaryIncomeDeduction(D(8_500_000)).toString()).toBe('1950000')
  })

  test('850万円超は一律195万円（上限、850万円の接続点で連続）', () => {
    expect(salaryIncomeDeduction(D(8_500_001)).toString()).toBe('1950000')
    expect(salaryIncomeDeduction(D(20_000_000)).toString()).toBe('1950000')
  })
})

describe('salaryIncomeAmount', () => {
  test('控除後がマイナスなら0円', () => {
    expect(salaryIncomeAmount(D(500_000)).toString()).toBe('0')
  })

  test('控除後がプラスならその額', () => {
    // 1,000,000 - 740,000 = 260,000
    expect(salaryIncomeAmount(D(1_000_000)).toString()).toBe('260000')
  })
})

describe('otherMiscIncome（その他雑所得＝収入−必要経費）', () => {
  test('通常はそのまま差し引く', () => {
    expect(otherMiscIncome(D(300_000), D(100_000)).toString()).toBe('200000')
  })

  test('マイナスは0円に floor', () => {
    expect(otherMiscIncome(D(100_000), D(150_000)).toString()).toBe('0')
  })
})

describe('otherIncomeAmount（給与所得＋雑所得の合算）', () => {
  test('何も入力が無ければ0円', () => {
    expect(otherIncomeAmount({}).toString()).toBe('0')
  })

  test('給与所得のみ', () => {
    const r = otherIncomeAmount({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
    })
    expect(r.toString()).toBe('260000')
  })

  test('給与所得＋公的年金等＋その他雑所得を合算する', () => {
    const r = otherIncomeAmount({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(0) },
      miscIncome: { publicPensionAmount: D(300_000), otherIncome: D(200_000), otherExpenses: D(50_000) },
    })
    // 260,000（給与） + 300,000（年金、直接入力） + 150,000（その他雑所得）
    expect(r.toString()).toBe('710000')
  })
})

describe('totalWithholdingTax（源泉徴収税額の合計）', () => {
  test('給与の源泉徴収税額のみ', () => {
    const r = totalWithholdingTax({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
    })
    expect(r.toString()).toBe('30000')
  })

  test('給与＋事業所得側の源泉徴収税額を合算する', () => {
    const r = totalWithholdingTax({
      salaryIncome: { paidAmount: D(1_000_000), withholdingTax: D(30_000) },
      otherWithholdingTax: D(10_000),
    })
    expect(r.toString()).toBe('40000')
  })

  test('何も入力が無ければ0円', () => {
    expect(totalWithholdingTax({}).toString()).toBe('0')
  })
})