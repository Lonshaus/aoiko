import { describe, it, expect } from 'vitest'
import { pathToChapter } from './manual-routes'

describe('pathToChapter', () => {
  it('機能ページを対応章へ写像', () => {
    expect(pathToChapter('/import')).toBe('03-csv-import')
    expect(pathToChapter('/reports')).toBe('06-reports')
    expect(pathToChapter('/settings')).toBe('01-setup')
    expect(pathToChapter('/import-history')).toBe('03-csv-import')
  })

  it('対応が無ければ null', () => {
    expect(pathToChapter('/')).toBeNull()
    expect(pathToChapter('/manual')).toBeNull()
  })
})