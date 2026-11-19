import { describe, expect, it } from 'vitest'
import { FRAME_COLORS } from '../src/features/editor/frame-layout'

describe('frame color defaults', () => {
  it('uses absolute black and white and preserves the old white as soft white', () => {
    expect(FRAME_COLORS.black).toBe('#000000')
    expect(FRAME_COLORS.white).toBe('#FFFFFF')
    expect(FRAME_COLORS.softWhite).toBe('#fafaf8')
  })
})
