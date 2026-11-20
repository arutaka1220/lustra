import { describe, expect, it } from 'vitest'
import { buildJustifiedRows } from '../src/features/review/justified-layout'

describe('justified review layout', () => {
  it('fills complete rows with equal heights and preserves each image ratio', () => {
    const rows = buildJustifiedRows([1.5, 0.7, 1.8, 0.8, 1.4, 0.65, 1.6], 1100, 10)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows.slice(0, -1)) {
      expect(row.widths.reduce((sum, width) => sum + width, 0) + 10 * (row.widths.length - 1)).toBeCloseTo(1100, 4)
      expect(row.widths.every((width) => width > 0)).toBe(true)
    }
    rows.forEach((row) => row.indices.forEach((index, offset) => {
      expect(row.widths[offset] / row.height).toBeCloseTo([1.5, 0.7, 1.8, 0.8, 1.4, 0.65, 1.6][index], 4)
    }))
  })

  it('keeps the final row natural width and responds to container resizing', () => {
    const ratios = Array.from({ length: 8 }, () => 1.5)
    const wide = buildJustifiedRows(ratios, 1200)
    const narrow = buildJustifiedRows(ratios, 700)
    const final = wide.at(-1)!
    expect(final.widths.reduce((sum, width) => sum + width, 0) + 10 * (final.widths.length - 1)).toBeLessThan(1200)
    expect(narrow[0].indices.length).not.toBe(wide[0].indices.length)
    expect(wide.flatMap((row) => row.indices)).toEqual(ratios.map((_, index) => index))
  })

  it('lays out 200 images without dropping or reordering any', () => {
    const ratios = Array.from({ length: 200 }, (_, index) => index % 2 ? 0.68 : 1.6)
    const rows = buildJustifiedRows(ratios, 1280)
    expect(rows.flatMap((row) => row.indices)).toEqual(ratios.map((_, index) => index))
    expect(rows.length).toBeGreaterThan(10)
  })
})
