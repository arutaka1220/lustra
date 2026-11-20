import { describe, expect, it } from 'vitest'
import { bestContrastingTextColor, createTextElement, textColor } from '../src/features/text/text-model'

describe('Typography text color', () => {
  it('chooses the higher contrast black or white across solid frame colors', () => {
    expect(bestContrastingTextColor('#000000')).toBe('#FFFFFF')
    expect(bestContrastingTextColor('#FFFFFF')).toBe('#000000')
    expect(bestContrastingTextColor('#242424')).toBe('#FFFFFF')
    expect(bestContrastingTextColor('#fafaf8')).toBe('#000000')
    expect(bestContrastingTextColor('#E8C7A4')).toBe('#000000')
  })

  it('uses the actual Custom frame color for Auto and preserves a custom text color separately', () => {
    expect(textColor('auto', 'custom', '#161616')).toBe('#FFFFFF')
    expect(textColor('auto', 'custom', '#f5f5f5')).toBe('#000000')
    const element = { ...createTextElement('Lustra'), color: 'auto' as const, customColor: '#E8C7A4' }
    expect(element.color).toBe('auto')
    expect(element.customColor).toBe('#E8C7A4')
  })

  it('keeps a safe fallback for malformed background colors', () => {
    expect(bestContrastingTextColor('bad')).toBe('#FFFFFF')
  })
})
