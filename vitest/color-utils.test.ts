import { describe, expect, it } from 'vitest'
import { hexToRgb, hsvToHex, parseHex, rgbToHex } from '../src/features/editor/color-utils'

describe('custom frame color conversion', () => {
  it('normalizes HEX and synchronizes RGB', () => {
    expect(parseHex('#aBc123')).toBe('#ABC123')
    expect(hexToRgb('#ABC123')).toEqual({ r: 171, g: 193, b: 35 })
    expect(rgbToHex({ r: 171, g: 193, b: 35 })).toBe('#ABC123')
  })
  it('rejects incomplete HEX and converts hue, saturation, and value', () => {
    expect(parseHex('#12')).toBeNull()
    expect(hsvToHex(0, 100, 100)).toBe('#FF0000')
    expect(hsvToHex(210, 50, 80)).toBe('#6699CC')
  })
})
