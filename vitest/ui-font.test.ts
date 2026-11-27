import { afterEach, describe, expect, it } from 'vitest'
import { applyJapaneseUiFont, isJapaneseUiFont } from '../src/i18n/ui-font'

afterEach(() => {
  delete document.documentElement.dataset.japaneseFont
})

describe('Japanese UI font selection', () => {
  it('validates saved font identifiers without accepting unknown values', () => {
    expect(isJapaneseUiFont('m-plus')).toBe(true)
    expect(isJapaneseUiFont('system-default')).toBe(false)
    expect(isJapaneseUiFont(null)).toBe(false)
  })

  it('applies Noto Sans JP as the default font', async () => {
    await expect(applyJapaneseUiFont('noto')).resolves.toBe('noto')
    expect(document.documentElement.dataset.japaneseFont).toBe('noto')
  })

  it('falls back to Noto when Hiragino is not available on the current OS', async () => {
    await expect(applyJapaneseUiFont('hiragino')).resolves.toBe('noto')
    expect(document.documentElement.dataset.japaneseFont).toBe('noto')
  })
})
