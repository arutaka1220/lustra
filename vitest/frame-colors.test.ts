import { describe, expect, it } from 'vitest'
import { FRAME_COLORS } from '../src/features/editor/frame-layout'
import { FRAME_STYLE_ORDER } from '../src/features/editor/FrameControls'

describe('frame color defaults', () => {
  it('uses absolute black and white and preserves the old white as soft white', () => {
    expect(FRAME_COLORS.black).toBe('#000000')
    expect(FRAME_COLORS.white).toBe('#FFFFFF')
    expect(FRAME_COLORS.softWhite).toBe('#fafaf8')
    expect(FRAME_COLORS.softBlack).toBe('#242424')
  })
  it('keeps the established styles and adds Ambient Gradient in the same picker', () => {
    expect(FRAME_STYLE_ORDER).toEqual(['black', 'white', 'blurred', 'softBlack', 'softWhite', 'ambientGradient', 'custom'])
  })
})
