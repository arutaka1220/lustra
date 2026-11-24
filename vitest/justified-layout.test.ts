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

  it('uses width and height for small galleries while retaining image ratios', () => {
    for (const ratios of [[0.65], [1.8], [0.7, 1.6], [1.6, 1.5, 0.8]]) {
      const rows = buildJustifiedRows(ratios, 1400, 10, 230, 800)
      expect(rows).toHaveLength(1)
      expect(rows[0].height).toBeGreaterThan(230)
      rows[0].indices.forEach((index, offset) => expect(rows[0].widths[offset] / rows[0].height).toBeCloseTo(ratios[index], 4))
    }
    expect(buildJustifiedRows([], 1000, 10, 230, 700)).toEqual([])
    expect(buildJustifiedRows([1.5, 1.5], 0, 10, 230, 700)).toEqual([])
  })

  it('caps short incomplete rows and avoids non-finite dimensions', () => {
    const rows = buildJustifiedRows([1.5, 1.5, 1.5, 1.5, 1.5, 1.5], 900, 10, 230, 500)
    expect(rows.flatMap((row) => row.indices)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rows.at(-1)!.height).toBeLessThanOrEqual(420)
    expect(rows.every((row) => Number.isFinite(row.height) && row.widths.every(Number.isFinite))).toBe(true)
  })

  it('does not apply the multi-row cap to a gallery that fits in one row', () => {
    const one = buildJustifiedRows([1.8], 1600, 10, 230, 900)
    expect(one[0].height).toBeCloseTo(1600 / 1.8)
    expect(one[0].widths[0]).toBeCloseTo(1600)

    const two = buildJustifiedRows([0.65, 0.7], 1200, 10, 230, 760)
    expect(two).toHaveLength(1)
    expect(two[0].height).toBeCloseTo(760)
    expect(two[0].widths[0] + two[0].widths[1] + 10).toBeLessThanOrEqual(1200)
    expect(two[0].height).toBeGreaterThan(420)
  })
})
