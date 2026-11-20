import { describe, expect, it } from 'vitest'
import { clampFilmstripHeight, DEFAULT_FILMSTRIP_HEIGHT, maxFilmstripHeight, MIN_FILMSTRIP_HEIGHT } from '../src/features/editor/filmstrip-layout'

describe('filmstrip height constraints', () => {
  it('clamps values to minimum and maximum heights', () => {
    expect(clampFilmstripHeight(1, 1000)).toBe(MIN_FILMSTRIP_HEIGHT)
    expect(clampFilmstripHeight(900, 1000)).toBe(400)
  })

  it('uses the default height for invalid saved values', () => {
    expect(clampFilmstripHeight(Number.NaN, 1000)).toBe(DEFAULT_FILMSTRIP_HEIGHT)
    expect(clampFilmstripHeight(Number.POSITIVE_INFINITY, 1000)).toBe(DEFAULT_FILMSTRIP_HEIGHT)
  })

  it('limits height to the editor space left for preview', () => {
    expect(maxFilmstripHeight(1000, 500)).toBe(169)
    expect(clampFilmstripHeight(320, 1000, 500)).toBe(169)
  })

  it('restores the default height when requested', () => {
    expect(clampFilmstripHeight(DEFAULT_FILMSTRIP_HEIGHT, 1000)).toBe(140)
  })
})
