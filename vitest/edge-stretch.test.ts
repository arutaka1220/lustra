import { describe, expect, test } from 'vitest'
import { edgeFadeWeight, edgeSampleCoordinate } from '../src/features/editor/edge-stretch'

describe('Edge Stretch sampling', () => {
  test('Extend clamps all four sides to their nearest edge', () => {
    expect(edgeSampleCoordinate(-2, 0, 4, 'extend')).toBe(0)
    expect(edgeSampleCoordinate(8, 0, 4, 'extend')).toBe(4)
    expect(edgeSampleCoordinate(2, 0, 4, 'extend')).toBe(2)
  })
  test('Mirror reflects repeatedly across the boundary for large padding', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(x => edgeSampleCoordinate(x, 0, 4, 'mirror'))).toEqual([1, 2, 3, 4, 3, 2, 1, 0])
    expect(edgeSampleCoordinate(-3, 0, 4, 'mirror')).toBe(3)
  })
  test('Fade is independent and smoothly falls off with distance', () => {
    expect(edgeFadeWeight(0, 8)).toBe(1)
    expect(edgeFadeWeight(4, 8)).toBeCloseTo(.5)
    expect(edgeFadeWeight(8, 8)).toBe(0)
    expect(edgeFadeWeight(0, 0)).toBe(0)
  })
})
