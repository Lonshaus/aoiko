// 機能ページ → マニュアル章の対応表。全マニュアルを束ねる manual.ts（eager glob）とは
// 切り離し、App から import してもメインバンドルに本文が混入しないようにする。
const ROUTE_CHAPTER: Record<string, string> = {
  '/journal': '02-journal',
  '/reports': '06-reports',
  '/import': '03-csv-import',
  '/import-history': '03-csv-import',
  '/order-import': '05-order-import',
  '/receipt': '04-receipt-ocr',
  '/settings': '01-setup',
  '/income-deductions': '14-income-deductions',
  '/invoices': '15-invoices',
}

export function pathToChapter(path: string): string | null {
  return ROUTE_CHAPTER[path] ?? null
}