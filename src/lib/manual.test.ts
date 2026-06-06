import { describe, it, expect } from 'vitest'
import {
  INDEX_SLUG,
  slugFromPath,
  chapterSlugs,
  hasChapter,
  getManualContent,
  extractTitle,
  adjacentChapters,
  rewriteLinks,
  stripLanguageNav,
} from './manual'

describe('stripLanguageNav', () => {
  it('言語切替行を取り除く', () => {
    const src = '# 01. 初次設定\n\n本文\n\n**Language**: [日本語](01-setup.md) | **繁體中文**\n\n続き'
    const out = stripLanguageNav(src)
    expect(out).not.toContain('**Language**')
    expect(out).toContain('# 01. 初次設定')
    expect(out).toContain('続き')
  })

  it('言語行が無ければそのまま', () => {
    const src = '# 見出し\n\n本文'
    expect(stripLanguageNav(src)).toBe(src)
  })
})

describe('slugFromPath', () => {
  it('/manual は索引 slug', () => {
    expect(slugFromPath('/manual')).toBe(INDEX_SLUG)
    expect(slugFromPath('/manual/')).toBe(INDEX_SLUG)
  })

  it('/manual/<slug> は章 slug を返す', () => {
    expect(slugFromPath('/manual/01-setup')).toBe('01-setup')
  })

  it('末尾スラッシュを除去する', () => {
    expect(slugFromPath('/manual/02-journal/')).toBe('02-journal')
  })
})

describe('chapterSlugs', () => {
  it('12 章を番号順で返し README を含まない', () => {
    expect(chapterSlugs()).toEqual([
      '01-setup',
      '02-journal',
      '03-csv-import',
      '04-receipt-ocr',
      '05-order-import',
      '06-reports',
      '07-consumption-tax',
      '08-depreciation',
      '09-carryover',
      '10-xtx-export',
      '11-backup',
      '12-amended',
    ])
    expect(chapterSlugs()).not.toContain(INDEX_SLUG)
  })
})

describe('hasChapter', () => {
  it('存在する slug は true、しないものは false', () => {
    expect(hasChapter('01-setup')).toBe(true)
    expect(hasChapter(INDEX_SLUG)).toBe(true)
    expect(hasChapter('999-nope')).toBe(false)
  })
})

describe('getManualContent', () => {
  it('指定 locale の本文を返す', () => {
    expect(getManualContent('01-setup', 'ja')).toContain('# ')
    expect(getManualContent('01-setup', 'zh-TW')).toContain('# ')
    expect(getManualContent('01-setup', 'en')).toContain('# ')
  })

  it('未知の slug は null', () => {
    expect(getManualContent('999-nope', 'ja')).toBeNull()
  })
})

describe('extractTitle', () => {
  it('最初の見出しを抜き出す', () => {
    expect(extractTitle('# はじめに\n\n本文')).toBe('はじめに')
  })

  it('前置きがあっても最初の h1 を取る', () => {
    expect(extractTitle('> 注意\n\n# 本題\n## 小見出し')).toBe('本題')
  })

  it('見出しが無ければ空文字', () => {
    expect(extractTitle('本文だけ')).toBe('')
  })
})

describe('adjacentChapters', () => {
  it('中間の章は前後を返す', () => {
    expect(adjacentChapters('02-journal')).toEqual({
      prev: '01-setup',
      next: '03-csv-import',
    })
  })

  it('最初の章は prev が null', () => {
    expect(adjacentChapters('01-setup').prev).toBeNull()
  })

  it('最後の章は next が null', () => {
    expect(adjacentChapters('12-amended').next).toBeNull()
  })

  it('章でない slug は両方 null', () => {
    expect(adjacentChapters(INDEX_SLUG)).toEqual({ prev: null, next: null })
  })
})

describe('rewriteLinks', () => {
  it('章リンクを SPA ルートへ書き換える', () => {
    expect(rewriteLinks('[次へ](02-journal.md)')).toBe('[次へ](/manual/02-journal)')
  })

  it('locale サフィックス付きも slug に正規化', () => {
    expect(rewriteLinks('[次へ](02-journal_zh-TW.md)')).toBe('[次へ](/manual/02-journal)')
    expect(rewriteLinks('[next](08-depreciation_en.md)')).toBe('[next](/manual/08-depreciation)')
  })

  it('README リンクは目次ルートへ', () => {
    expect(rewriteLinks('[目次](README_zh-TW.md)')).toBe('[目次](/manual)')
  })

  it('アンカーを保持する', () => {
    expect(rewriteLinks('[節](03-csv-import_zh-TW.md#rules)')).toBe('[節](/manual/03-csv-import#rules)')
  })

  it('./ 接頭辞を許容', () => {
    expect(rewriteLinks('[x](./05-order-import.md)')).toBe('[x](/manual/05-order-import)')
  })

  it('マニュアル外リンク（../../README）は書き換えない', () => {
    const src = '[主 README](../../README_zh-TW.md)'
    expect(rewriteLinks(src)).toBe(src)
  })

  it('外部 URL は書き換えない', () => {
    const src = '[issues](https://github.com/Lonshaus/aoiko/issues)'
    expect(rewriteLinks(src)).toBe(src)
  })
})