import type { Account } from '$lib/../db/types';
// 青色申告決算書（一般用）の標準勘定科目。
//
// 準拠：令和7年分（最新公告）一般用フォーム。令和8年分の様式は本コミット時点
// （2026-05-23）未公告（国税庁は通常、秋〜冬に翌年分を公開）。令和8年分が
// 公告され差分が確認できたら本ファイルを更新する。
//
// 設計方針：
// - 一般用 PL の 18 経費科目（租税公課〜雑費）はすべて収録、順序も form 通り
// - 売上原価（仕入・棚卸高）、専従者給与、貸倒引当金繰入額・引当金、
//   標準的な BS 固定資産（建物・車両運搬具・土地等）、借入金 等の
//   form 上の主要科目を網羅
// - aoiko には Account を UI から追加する画面が無いため、本 seed が
//   利用者がアクセスできる勘定科目の総体となる
// - 既存ユーザのデータ互換のため、既存 code / name は変更しない（追加のみ）

export const ACCOUNTS_2026: Account[] = [
  // 資産（1xxx）— 流動資産
  { code: '1110', year: 2026, name: '現金',           category: 'asset', displayOrder: 110 },
  { code: '1120', year: 2026, name: '当座預金',       category: 'asset', displayOrder: 120 },
  { code: '1130', year: 2026, name: '普通預金',       category: 'asset', displayOrder: 130 },
  { code: '1140', year: 2026, name: '定期預金',       category: 'asset', displayOrder: 140 },
  { code: '1210', year: 2026, name: '受取手形',       category: 'asset', displayOrder: 210 },
  { code: '1310', year: 2026, name: '売掛金',         category: 'asset', displayOrder: 310 },
  { code: '1320', year: 2026, name: '未収入金',       category: 'asset', displayOrder: 320 },
  { code: '1330', year: 2026, name: '有価証券',       category: 'asset', displayOrder: 330 },
  { code: '1340', year: 2026, name: '棚卸資産',       category: 'asset', displayOrder: 340 },
  { code: '1410', year: 2026, name: '前払費用',       category: 'asset', displayOrder: 410 },
  { code: '1420', year: 2026, name: '貸付金',         category: 'asset', displayOrder: 420 },
  // 資産（1xxx）— 固定資産
  { code: '1510', year: 2026, name: '工具器具備品',   category: 'asset', displayOrder: 510 },
  { code: '1511', year: 2026, name: '建物',           category: 'asset', displayOrder: 511 },
  { code: '1512', year: 2026, name: '建物附属設備',   category: 'asset', displayOrder: 512 },
  { code: '1513', year: 2026, name: '機械装置',       category: 'asset', displayOrder: 513 },
  { code: '1514', year: 2026, name: '車両運搬具',     category: 'asset', displayOrder: 514 },
  { code: '1515', year: 2026, name: '土地',           category: 'asset', displayOrder: 515 },
  { code: '1520', year: 2026, name: '減価償却累計額', category: 'asset', displayOrder: 520 },
  // 資産（1xxx）— 繰延資産
  { code: '1530', year: 2026, name: '開業費',         category: 'asset', displayOrder: 530 },
  // 資産（1xxx）— 事業主貸
  { code: '1610', year: 2026, name: '事業主貸',       category: 'asset', displayOrder: 610 },
  // 負債（2xxx）
  { code: '2105', year: 2026, name: '支払手形',       category: 'liability', displayOrder: 105 },
  { code: '2110', year: 2026, name: '買掛金',         category: 'liability', displayOrder: 110 },
  { code: '2120', year: 2026, name: '未払金',         category: 'liability', displayOrder: 120 },
  { code: '2130', year: 2026, name: '未払費用',       category: 'liability', displayOrder: 130 },
  { code: '2140', year: 2026, name: '預り金',         category: 'liability', displayOrder: 140 },
  { code: '2150', year: 2026, name: '前受金',         category: 'liability', displayOrder: 150 },
  { code: '2160', year: 2026, name: '借入金',         category: 'liability', displayOrder: 160 },
  { code: '2170', year: 2026, name: '貸倒引当金',     category: 'liability', displayOrder: 170 },
  // 純資産（3xxx）
  { code: '3110', year: 2026, name: '元入金',         category: 'equity', displayOrder: 110 },
  { code: '3120', year: 2026, name: '事業主借',       category: 'equity', displayOrder: 120 },
  // 収益（4xxx）
  { code: '4110', year: 2026, name: '売上高',         category: 'revenue', taxCategory: 'taxable10', displayOrder: 110 },
  { code: '4910', year: 2026, name: '雑収入',         category: 'revenue', taxCategory: 'taxable10', displayOrder: 910 },
  // 収益（4xxx）— 不動産所得用（B7 part2、freee/MF と同じく科目を複製）。
  // 賃貸料・礼金等は住宅家賃なら非課税が多いため既定は 'exempt'、店舗等の課税賃貸は
  // 仕訳行の taxCategory 上書きで対応（既存の taxCategory override と同じ運用）。
  { code: '4210', year: 2026, name: '賃貸料（不動産）',     category: 'revenue', taxCategory: 'exempt', incomeType: 'realEstate', displayOrder: 210 },
  { code: '4220', year: 2026, name: '礼金・権利金等（不動産）', category: 'revenue', taxCategory: 'exempt', incomeType: 'realEstate', displayOrder: 220 },
  { code: '4920', year: 2026, name: '雑収入（不動産）',     category: 'revenue', taxCategory: 'taxable10', incomeType: 'realEstate', displayOrder: 920 },
  // 費用（5xxx）— 売上原価
  { code: '5010', year: 2026, name: '期首商品棚卸高', category: 'expense', taxCategory: 'nontaxable', displayOrder: 10 },
  { code: '5020', year: 2026, name: '仕入',           category: 'expense', taxCategory: 'taxable10', displayOrder: 20 },
  { code: '5030', year: 2026, name: '期末商品棚卸高', category: 'expense', taxCategory: 'nontaxable', displayOrder: 30 },
  // 費用（5xxx）— 一般用 PL 経費 ⑥〜（form 順）
  { code: '5110', year: 2026, name: '租税公課',       category: 'expense', taxCategory: 'nontaxable', displayOrder: 110 },
  { code: '5120', year: 2026, name: '荷造運賃',       category: 'expense', taxCategory: 'taxable10', displayOrder: 120 },
  { code: '5130', year: 2026, name: '水道光熱費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 130 },
  { code: '5140', year: 2026, name: '旅費交通費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 140 },
  { code: '5150', year: 2026, name: '通信費',         category: 'expense', taxCategory: 'taxable10', displayOrder: 150 },
  { code: '5160', year: 2026, name: '広告宣伝費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 160 },
  { code: '5170', year: 2026, name: '接待交際費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 170 },
  { code: '5180', year: 2026, name: '損害保険料',     category: 'expense', taxCategory: 'nontaxable', displayOrder: 180 },
  { code: '5190', year: 2026, name: '修繕費',         category: 'expense', taxCategory: 'taxable10', displayOrder: 190 },
  { code: '5200', year: 2026, name: '消耗品費',       category: 'expense', taxCategory: 'taxable10', displayOrder: 200 },
  { code: '5210', year: 2026, name: '減価償却費',     category: 'expense', taxCategory: 'nontaxable', displayOrder: 210 },
  { code: '5220', year: 2026, name: '福利厚生費',     category: 'expense', taxCategory: 'taxable10', displayOrder: 220 },
  { code: '5230', year: 2026, name: '給料賃金',       category: 'expense', taxCategory: 'nontaxable', displayOrder: 230 },
  { code: '5240', year: 2026, name: '外注工賃',       category: 'expense', taxCategory: 'taxable10', displayOrder: 240 },
  { code: '5250', year: 2026, name: '利子割引料',     category: 'expense', taxCategory: 'nontaxable', displayOrder: 250 },
  { code: '5260', year: 2026, name: '地代家賃',       category: 'expense', taxCategory: 'taxable10', displayOrder: 260 },
  { code: '5270', year: 2026, name: '貸倒金',         category: 'expense', taxCategory: 'nontaxable', displayOrder: 270 },
  // 固定資産の除却損（B6）。青色申告決算書一般用の18経費科目には対応欄が無いため
  // KOA210/KOA110 の個別明細行には出力されない（tagByJa 不一致で silently 出力スキップ）が、
  // pl.netIncome は通常の経費として正しく反映される（専従者控除前の所得金額 等の合計値は正しい）。
  { code: '5280', year: 2026, name: '固定資産除却損', category: 'expense', taxCategory: 'nontaxable', displayOrder: 280 },
  { code: '5910', year: 2026, name: '雑費',           category: 'expense', taxCategory: 'taxable10', displayOrder: 910 },
  // 費用（5xxx）— 引当金繰入額・専従者給与（form 順では雑費の後）
  { code: '5810', year: 2026, name: '貸倒引当金繰入額', category: 'expense', taxCategory: 'nontaxable', displayOrder: 810 },
  { code: '5820', year: 2026, name: '専従者給与',       category: 'expense', taxCategory: 'nontaxable', displayOrder: 820 },
  // 費用（5xxx）— 不動産所得用（B7 part2、KOA220 第1頁の必要経費区分に対映）。
  // 貸倒引当金繰入額（不動産）は事業的規模の遡及見直しルールが複雑なため対象外
  // （real-estate-income.ts 冒頭コメント参照、科目自体を追加していない）。
  { code: '5310', year: 2026, name: '租税公課（不動産）',   category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1310 },
  { code: '5320', year: 2026, name: '損害保険料（不動産）', category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1320 },
  { code: '5330', year: 2026, name: '修繕費（不動産）',     category: 'expense', taxCategory: 'taxable10', incomeType: 'realEstate', displayOrder: 1330 },
  { code: '5340', year: 2026, name: '減価償却費（不動産）', category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1340 },
  { code: '5350', year: 2026, name: '借入金利子（不動産）', category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1350 },
  { code: '5360', year: 2026, name: '地代家賃（不動産）',   category: 'expense', taxCategory: 'taxable10', incomeType: 'realEstate', displayOrder: 1360 },
  { code: '5370', year: 2026, name: '給料賃金（不動産）',   category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1370 },
  { code: '5380', year: 2026, name: '専従者給与（不動産）', category: 'expense', taxCategory: 'nontaxable', incomeType: 'realEstate', displayOrder: 1380 },
  { code: '5390', year: 2026, name: '雑費（不動産）',       category: 'expense', taxCategory: 'taxable10', incomeType: 'realEstate', displayOrder: 1390 },
];