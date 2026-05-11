import type { Account } from '$lib/../db/types';

// 青色申告決算書（一般用）の標準勘定科目 — 初期セット。
// TODO: 令和8年分（2026）の青色申告決算書最終公告と照らし合わせて、各 code と displayOrder を検証する。
// 出典優先順位：国税庁公式 PDF ＞ 各社会計ソフトの対照表。

export const ACCOUNTS_2026: Account[] = [
  // 資産（1xxx）
  { code: '1110', year: 2026, name: '現金',         category: 'asset', displayOrder: 110 },
  { code: '1120', year: 2026, name: '当座預金',     category: 'asset', displayOrder: 120 },
  { code: '1130', year: 2026, name: '普通預金',     category: 'asset', displayOrder: 130 },
  { code: '1140', year: 2026, name: '定期預金',     category: 'asset', displayOrder: 140 },
  { code: '1310', year: 2026, name: '売掛金',       category: 'asset', displayOrder: 310 },
  { code: '1320', year: 2026, name: '未収入金',     category: 'asset', displayOrder: 320 },
  { code: '1410', year: 2026, name: '前払費用',     category: 'asset', displayOrder: 410 },
  { code: '1510', year: 2026, name: '工具器具備品', category: 'asset', displayOrder: 510 },
  { code: '1520', year: 2026, name: '減価償却累計額', category: 'asset', displayOrder: 520 },
  { code: '1610', year: 2026, name: '事業主貸',     category: 'asset', displayOrder: 610 },

  // 負債（2xxx）
  { code: '2110', year: 2026, name: '買掛金',       category: 'liability', displayOrder: 110 },
  { code: '2120', year: 2026, name: '未払金',       category: 'liability', displayOrder: 120 },
  { code: '2130', year: 2026, name: '未払費用',     category: 'liability', displayOrder: 130 },
  { code: '2140', year: 2026, name: '預り金',       category: 'liability', displayOrder: 140 },
  { code: '2150', year: 2026, name: '前受金',       category: 'liability', displayOrder: 150 },

  // 純資産（3xxx）
  { code: '3110', year: 2026, name: '元入金',       category: 'equity', displayOrder: 110 },
  { code: '3120', year: 2026, name: '事業主借',     category: 'equity', displayOrder: 120 },

  // 収益（4xxx）
  { code: '4110', year: 2026, name: '売上高',       category: 'revenue', taxCategory: 'taxable10', displayOrder: 110 },
  { code: '4910', year: 2026, name: '雑収入',       category: 'revenue', taxCategory: 'taxable10', displayOrder: 910 },

  // 費用（5xxx）
  { code: '5110', year: 2026, name: '租税公課',     category: 'expense', taxCategory: 'nontaxable', displayOrder: 110 },
  { code: '5120', year: 2026, name: '荷造運賃',     category: 'expense', taxCategory: 'taxable10', displayOrder: 120 },
  { code: '5130', year: 2026, name: '水道光熱費',   category: 'expense', taxCategory: 'taxable10', displayOrder: 130 },
  { code: '5140', year: 2026, name: '旅費交通費',   category: 'expense', taxCategory: 'taxable10', displayOrder: 140 },
  { code: '5150', year: 2026, name: '通信費',       category: 'expense', taxCategory: 'taxable10', displayOrder: 150 },
  { code: '5160', year: 2026, name: '広告宣伝費',   category: 'expense', taxCategory: 'taxable10', displayOrder: 160 },
  { code: '5170', year: 2026, name: '接待交際費',   category: 'expense', taxCategory: 'taxable10', displayOrder: 170 },
  { code: '5180', year: 2026, name: '損害保険料',   category: 'expense', taxCategory: 'nontaxable', displayOrder: 180 },
  { code: '5190', year: 2026, name: '修繕費',       category: 'expense', taxCategory: 'taxable10', displayOrder: 190 },
  { code: '5200', year: 2026, name: '消耗品費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 200 },
  { code: '5210', year: 2026, name: '減価償却費',   category: 'expense', taxCategory: 'nontaxable', displayOrder: 210 },
  { code: '5220', year: 2026, name: '福利厚生費',   category: 'expense', taxCategory: 'taxable10', displayOrder: 220 },
  { code: '5230', year: 2026, name: '給料賃金',     category: 'expense', taxCategory: 'nontaxable', displayOrder: 230 },
  { code: '5240', year: 2026, name: '外注工賃',     category: 'expense', taxCategory: 'taxable10', displayOrder: 240 },
  { code: '5250', year: 2026, name: '利子割引料',   category: 'expense', taxCategory: 'nontaxable', displayOrder: 250 },
  { code: '5260', year: 2026, name: '地代家賃',     category: 'expense', taxCategory: 'taxable10', displayOrder: 260 },
  { code: '5270', year: 2026, name: '貸倒金',       category: 'expense', taxCategory: 'nontaxable', displayOrder: 270 },
  { code: '5910', year: 2026, name: '雑費',         category: 'expense', taxCategory: 'taxable10', displayOrder: 910 },
];