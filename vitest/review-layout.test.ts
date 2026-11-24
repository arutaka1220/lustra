import { describe, expect, it } from 'vitest'
import { buildReviewLayout } from '../src/features/review/review-layout'

function assertTiles(aspects: number[], tiles: ReturnType<typeof buildReviewLayout>['tiles'], width: number, height: number) {
  expect(tiles.map((tile) => tile.index)).toEqual(aspects.map((_, index) => index))
  for (const tile of tiles) {
    expect(tile.width).toBeGreaterThan(0)
    expect(tile.height).toBeGreaterThan(0)
    expect(tile.x).toBeGreaterThanOrEqual(0)
    expect(tile.y).toBeGreaterThanOrEqual(0)
    expect(tile.x + tile.width).toBeLessThanOrEqual(width + 1)
    expect(tile.y + tile.height).toBeLessThanOrEqual(height + 1)
    const containedWidth = Math.min(tile.width, tile.height * aspects[tile.index])
    const containedHeight = containedWidth / aspects[tile.index]
    expect(containedWidth / containedHeight).toBeCloseTo(aspects[tile.index], 4)
  }
  for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) {
    const left = tiles[a], right = tiles[b]
    const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
    const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
    expect(overlapX > 0 && overlapY > 0).toBe(false)
  }
}

describe('adaptive review layout', () => {
  it('uses mosaic splits for mixed portrait and landscape photos', () => {
    const ratios = [0.65, 0.7, 1.8, 1.6]
    const layout = buildReviewLayout(ratios, 1200, 760)
    expect(layout.mode).toBe('mosaic')
    assertTiles(ratios, layout.tiles, 1198, 758)
  })

  it('covers portrait, landscape, square, tiny, empty, and large collections', () => {
    for (const ratios of [[0.5], [2], [0.65, 0.7], [1.8, 1.6], [1, 1, 1], [0.15, 5]]) {
      const layout = buildReviewLayout(ratios, 1200, 760)
      assertTiles(ratios, layout.tiles, 1198, 758)
    }
    expect(buildReviewLayout([], 1200, 760).tiles).toEqual([])
    for (const count of [5, 8, 10, 30, 50, 100, 200]) {
      const ratios = Array.from({ length: count }, (_, index) => index % 2 ? 0.7 : 1.7)
      const layout = buildReviewLayout(ratios, 1200, 760)
      expect(layout.tiles).toHaveLength(count)
      expect(layout.mode).toBe(count <= 8 ? 'mosaic' : 'justified')
    }
  })
})
