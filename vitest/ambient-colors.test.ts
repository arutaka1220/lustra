import { describe, expect, it } from 'vitest'
import { extractAmbientColors, extractAmbientSamples } from '../src/features/editor/ambient-colors'

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

  it('keeps spatial color locations instead of assigning arbitrary gradient positions', () => {
    const image = rgba(48, 48, (x, y) => x < 16 ? [18, 50, 210] : x > 34 && y < 16 ? [240, 120, 30] : [130, 70, 180])
    const samples = extractAmbientSamples(image, 48, 48, 'fullImage')
    const blue = samples.find(sample => sample.color === 'rgb(18,50,210)')
    const warm = samples.find(sample => sample.color === 'rgb(240,120,30)')
    expect(blue).toBeDefined()
    expect(warm).toBeDefined()
    expect(blue!.x).toBeLessThan(0.4)
    expect(warm!.x).toBeGreaterThan(0.65)
    expect(warm!.y).toBeLessThan(0.4)
  })

  it('retains a characteristic highlight against a large dark region without inventing colors', () => {
    const image = rgba(48, 48, (x, y) => x > 38 && y < 10 ? [240, 130, 45] : [8, 16, 38])
    const samples = extractAmbientSamples(image, 48, 48, 'fullImage')
    expect(samples.map(sample => sample.color)).toContain('rgb(240,130,45)')
    expect(samples.length).toBeLessThanOrEqual(2)
    expect(extractAmbientColors(image, 48, 48, 'fullImage')).toEqual(extractAmbientColors(image, 48, 48, 'fullImage'))
  })
})
