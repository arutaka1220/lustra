import { describe, expect, it } from 'vitest'
import { extractAmbientColors } from '../src/features/editor/ambient-colors'

function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, [r, g, b] = pixel(x, y)
    data.set([r, g, b, 255], i)
  }
  return data
}

describe('Ambient Gradient color extraction', () => {
  it('distinguishes different images and is stable for solid, dark and bright samples', () => {
    const red = rgba(4, 3, () => [180, 32, 20])
    const blue = rgba(96, 48, () => [12, 24, 140])
    expect(extractAmbientColors(red, 4, 3, 'fullImage')).not.toEqual(extractAmbientColors(blue, 96, 48, 'fullImage'))
    expect(extractAmbientColors(rgba(1, 1, () => [4, 4, 4]), 1, 1, 'fullImage')).toHaveLength(1)
    expect(extractAmbientColors(rgba(2, 2, () => [250, 248, 245]), 2, 2, 'fullImage')).toHaveLength(1)
  })

  it('uses edge pixels for Edges and up to five representative colors', () => {
    const image = rgba(48, 48, (x, y) => x > 8 && x < 39 && y > 8 && y < 39 ? [220, 25, 25] : [15, 30, 180])
    expect(extractAmbientColors(image, 48, 48, 'fullImage').join(' ')).toContain('220,25,25')
    expect(extractAmbientColors(image, 48, 48, 'edges')).toEqual(['rgb(15,30,180)'])
    expect(extractAmbientColors(image, 48, 48, 'fullImage').length).toBeLessThanOrEqual(5)
  })
})
