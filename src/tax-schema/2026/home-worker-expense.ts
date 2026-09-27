import { D, type Decimal } from '../../lib/decimal';
import { salaryIncomeDeduction } from './other-income';
// 家内労働者等の事業所得等の所得計算の特例（措法27条・措令18条の2）。
// 令和8年法律第12号附則34条：69万円は令和8年分以後に適用、令和7年分以前は65万円。
const HOME_WORKER_REFORM_YEAR = 2026;
const HOME_WORKER_MINIMUM = 690_000;
const HOME_WORKER_MINIMUM_BEFORE_REFORM = 650_000;

interface HomeWorkerIncomeSide {
  totalRevenue: Decimal;
  expenses: Decimal;
}

export interface HomeWorkerExpenseInput {
  year: number;
  /** 家内労働者・外交員・集金人・電力量計の検針人その他特定の者に継続的に人的役務を提供する者 */
  isHomeWorker?: boolean;
  salaryPaidAmount?: Decimal;
  business?: HomeWorkerIncomeSide;
  /** 雑所得（公的年金等に係るものを除く） */
  misc?: HomeWorkerIncomeSide;
}

export interface HomeWorkerExpenseResult {
  applied: boolean;
  businessExpenses: Decimal;
  miscExpenses: Decimal;
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

function maxZero(value: Decimal): Decimal {
  return value.lessThan(0) ? D(0) : value;
}
// 給与所得を有する場合は最低保障額から給与所得控除額を差し引いた残額（措法27条括弧書）。
export function homeWorkerGuaranteeAmount(year: number, salaryPaidAmount?: Decimal): Decimal {
  const base = D(
    year >= HOME_WORKER_REFORM_YEAR ? HOME_WORKER_MINIMUM : HOME_WORKER_MINIMUM_BEFORE_REFORM,
  );
  if (!salaryPaidAmount || salaryPaidAmount.lessThanOrEqualTo(0)) {
    return base;
  }
  return maxZero(base.minus(salaryIncomeDeduction(year, salaryPaidAmount)));
}

export function homeWorkerNecessaryExpenses(
  input: HomeWorkerExpenseInput,
): HomeWorkerExpenseResult {
  const businessActual = input.business?.expenses ?? D(0);
  const miscActual = input.misc?.expenses ?? D(0);
  const actual = { applied: false, businessExpenses: businessActual, miscExpenses: miscActual };
  if (!input.isHomeWorker || (!input.business && !input.misc)) {
    return actual;
  }
  const guarantee = homeWorkerGuaranteeAmount(input.year, input.salaryPaidAmount);
  if (businessActual.plus(miscActual).greaterThanOrEqualTo(guarantee)) {
    return actual;
  }
  if (input.business && input.misc) {
    // 措令18条の2第2項2号：事業所得の実額までを事業側、残りを雑所得側とし、雑所得の収入に収まらない分は事業側へ戻す。
    const businessBase = minDecimal(guarantee, businessActual);
    const miscPart = guarantee.minus(businessBase);
    const shortfall = maxZero(miscPart.minus(input.misc.totalRevenue));
    return {
      applied: true,
      businessExpenses: minDecimal(businessBase.plus(shortfall), input.business.totalRevenue),
      miscExpenses: minDecimal(miscPart, input.misc.totalRevenue),
    };
  }
  if (input.business) {
    return {
      applied: true,
      businessExpenses: minDecimal(guarantee, input.business.totalRevenue),
      miscExpenses: D(0),
    };
  }
  return {
    applied: true,
    businessExpenses: D(0),
    miscExpenses: minDecimal(guarantee, input.misc?.totalRevenue ?? D(0)),
  };
}
