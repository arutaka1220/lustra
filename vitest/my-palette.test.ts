import { beforeEach, describe, expect, it } from 'vitest'
import { loadPalette, normalizePalette, savePalette } from '../src/features/editor/MyPalette'

describe('My Palette colors', () => {
  beforeEach(() => localStorage.clear())

  it('normalizes colors and removes duplicate or invalid entries', () => {
    expect(normalizePalette(['#abcdef', '#ABCDEF', '#12', 4, '#010203'])).toEqual(['#ABCDEF', '#010203'])
  })

  it('caps palettes at sixteen colors and persists normalized color codes', () => {
    const colors = Array.from({ length: 20 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`)
    const saved = savePalette(colors)
    expect(saved).toHaveLength(16)
    expect(loadPalette()).toEqual(saved)
    expect(saved.every(color => /^#[\dA-F]{6}$/.test(color))).toBe(true)
  })
})
