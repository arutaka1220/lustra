import { describe, expect, it } from 'vitest'
import { formatCaptureDate } from '../src/features/text/date-format'
import { resolveTemplate } from '../src/features/text/text-model'

describe('capture date formatting', () => {
  it.each([
    '2026:11:07 14:19:45',
    '2026:11:07 14:19:45.90+09:00',
    '2026-11-07T14:19:45.90+09:00',
  ])('formats %s without changing its wall-clock time', (raw) => {
    expect(formatCaptureDate(raw, 'ja')).toBe('2026/11/07 14:19:45')
    expect(formatCaptureDate(raw, 'en')).toBe('Nov 7, 2026, 14:19:45')
  })

  it('formats date variables while preserving the metadata source value', () => {
    const raw = '2026:11:07 14:19:45.90+09:00'
    expect(resolveTemplate('Shot {date}', { date: raw }, 'en').text).toBe('Shot Nov 7, 2026, 14:19:45')
    expect(formatCaptureDate('not a timestamp', 'ja')).toBe('not a timestamp')
  })
})
