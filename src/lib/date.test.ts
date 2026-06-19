import { describe, expect, test } from 'vitest'
import { toISODateLocal, todayISO } from './date'

describe('toISODateLocal', () => {
  test('formats a local date as YYYY-MM-DD', () => {
    expect(toISODateLocal(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(toISODateLocal(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  test('pads month and day to two digits', () => {
    expect(toISODateLocal(new Date(2026, 4, 5))).toBe('2026-05-05')
  })

  test('uses local time, not UTC (JST 深夜でも前日にならない)', () => {
    // ローカル 2026-01-01 00:30 は UTC 変換だと前年 12/31 になりうるが、ローカル日付を返す
    const d = new Date(2026, 0, 1, 0, 30)
    expect(toISODateLocal(d)).toBe('2026-01-01')
  })
})

describe('todayISO', () => {
  test('returns YYYY-MM-DD format matching local now', () => {
    const now = new Date()
    expect(todayISO()).toBe(toISODateLocal(now))
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})