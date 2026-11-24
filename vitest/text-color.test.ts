import { describe, expect, it } from 'vitest'
import { autoFrameTextColor, bestContrastingTextColor, createTextElement, migrateLegacyTextColor, resolveFrameTextColor } from '../src/features/text/text-model'

const legacyElements = (...colors: string[]) => colors.map((color, index) => ({
  ...createTextElement(String(index)),
  color,
  ...(color.startsWith('#') ? { customColor: color } : {}),
}))

describe('Frame text color', () => {
  it('chooses the higher contrast black or white across solid frame colors', () => {
    expect(bestContrastingTextColor('#000000')).toBe('#FFFFFF')
    expect(bestContrastingTextColor('#FFFFFF')).toBe('#000000')
    expect(bestContrastingTextColor('#242424')).toBe('#FFFFFF')
    expect(bestContrastingTextColor('#fafaf8')).toBe('#000000')
    expect(bestContrastingTextColor('#E8C7A4')).toBe('#000000')
  })

  it('uses a stable automatic color for every frame style', () => {
    expect(autoFrameTextColor('black')).toBe('#FFFFFF')
    expect(autoFrameTextColor('softBlack')).toBe('#FFFFFF')
    expect(autoFrameTextColor('white')).toBe('#000000')
    expect(autoFrameTextColor('softWhite')).toBe('#000000')
    expect(autoFrameTextColor('custom', '#161616')).toBe('#FFFFFF')
    expect(autoFrameTextColor('custom', '#f5f5f5')).toBe('#000000')
    for (const style of ['blurred', 'ambientGradient', 'edgeStretch', 'none'] as const) {
      expect(autoFrameTextColor(style)).toBe('#FFFFFF')
    }
  })

  it('keeps a manual color while Auto toggles and the frame changes', () => {
    const manual = { style: 'black', autoTextColor: false, manualTextColor: '#E8C7A4' } as const
    expect(resolveFrameTextColor(manual)).toBe('#E8C7A4')
    expect(resolveFrameTextColor({ ...manual, style: 'white' })).toBe('#E8C7A4')
    expect(resolveFrameTextColor({ ...manual, autoTextColor: true, style: 'white' })).toBe('#000000')
    expect(manual.manualTextColor).toBe('#E8C7A4')
  })

  it('migrates the most common legacy custom color and removes per-layer color state', () => {
    const migrated = migrateLegacyTextColor({
      style: 'black',
      textElements: legacyElements('#D9A86C', '#D9A86C', 'auto', '#123456'),
    })
    expect(migrated).toMatchObject({ autoTextColor: false, manualTextColor: '#D9A86C' })
    expect(migrated.textElements?.every((element) => element.color === undefined && element.customColor === undefined)).toBe(true)
  })

  it('migrates tie cases by first custom color in layer order', () => {
    const migrated = migrateLegacyTextColor({
      style: 'black',
      textElements: legacyElements('#123456', '#AABBCC'),
    })
    expect(migrated).toMatchObject({ autoTextColor: false, manualTextColor: '#123456' })
  })

  it('migrates an explicit legacy shared Global Text Color into the manual color', () => {
    const migrated = migrateLegacyTextColor({
      style: 'black',
      globalTextColor: '#D9A86C',
      textElements: legacyElements('global', '#123456'),
    } as any)
    expect(migrated).toMatchObject({ autoTextColor: false, manualTextColor: '#D9A86C' })
    expect(migrated).not.toHaveProperty('globalTextColor')
  })

  it('keeps legacy Auto mode enabled by default when layers have no custom color', () => {
    const migrated = migrateLegacyTextColor({
      style: 'none',
      textElements: legacyElements('auto'),
    })
    expect(migrated.autoTextColor).toBeUndefined()
    expect(resolveFrameTextColor(migrated as any)).toBe('#FFFFFF')
  })

  it('keeps a safe fallback for malformed background colors', () => {
    expect(bestContrastingTextColor('bad')).toBe('#FFFFFF')
  })
})
