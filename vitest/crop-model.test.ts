import { describe, expect, it } from 'vitest'
import { FULL_CROP, INITIAL_CROP_TRANSFORM, moveCrop, ratioValue, resetCropTransform, resizeCrop, validCrop } from '../src/features/editor/crop-model'

describe('crop model', () => {
  it('defaults to the full normalized source and clamps invalid rectangles', () => {
    expect(validCrop()).toEqual(FULL_CROP)
    const clamped = validCrop({ x: 0.8, y: 0.8, width: 1, height: 1 })
    expect(clamped.x + clamped.width).toBeCloseTo(1)
    expect(clamped.y + clamped.height).toBeCloseTo(1)
  })
  it('maps source and custom ratios while leaving free crop unconstrained', () => {
    expect(ratioValue('original', 600, 400)).toBe(1.5)
    expect(ratioValue('custom', 600, 400, 2)).toBe(2)
    expect(ratioValue('free', 600, 400)).toBeUndefined()
  })
  it('resets crop controls independently while reserving full composition reset for the category action', () => {
    const crop = { x: 0.2, y: 0.15, width: 0.4, height: 0.5, rotation: 17, ratio: 'custom' as const, customRatio: 1.2, locked: false }
    const ratioReset = resetCropTransform(crop, 'ratio', 1200, 800)!
    expect(ratioReset).toMatchObject({ rotation: 17, ratio: 'original', locked: false })
    expect(ratioReset.customRatio).toBeUndefined()
    expect(ratioReset.width).toBeCloseTo(0.4)
    expect(ratioReset.height).toBeCloseTo(0.4)
    expect((ratioReset.width * 1200) / (ratioReset.height * 800)).toBeCloseTo(1.5)
    expect(ratioReset.x + ratioReset.width / 2).toBeCloseTo(crop.x + crop.width / 2)
    expect(ratioReset.y + ratioReset.height / 2).toBeCloseTo(crop.y + crop.height / 2)

    expect(resetCropTransform(crop, 'rotation', 1200, 800)).toMatchObject({ ...crop, rotation: 0 })
    expect(resetCropTransform(crop, 'lock', 1200, 800)).toMatchObject({ ...crop, locked: true })
    expect(resetCropTransform(crop, 'crop', 1200, 800)).toBeUndefined()
    expect(INITIAL_CROP_TRANSFORM).toMatchObject({ x: 0, y: 0, width: 1, height: 1, rotation: 0, ratio: 'original', locked: true })
  })
  it('resizes inside source bounds and moves without changing size', () => {
    expect(resizeCrop(FULL_CROP, 'se', -0.2, -0.1)).toEqual({ x: 0, y: 0, width: 0.8, height: 0.9 })
    const locked = resizeCrop(FULL_CROP, 'se', -0.2, -0.1, 2)
    expect(locked.width / locked.height).toBeCloseTo(2)
    expect(locked.x).toBeGreaterThanOrEqual(0)
    expect(locked.y).toBeGreaterThanOrEqual(0)
    expect(locked.x + locked.width).toBeLessThanOrEqual(1)
    expect(locked.y + locked.height).toBeLessThanOrEqual(1)
    expect(moveCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 1, -1)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 })
  })
})
