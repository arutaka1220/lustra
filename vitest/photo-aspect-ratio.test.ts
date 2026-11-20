import { describe, expect, it } from 'vitest'
import { classifyPhotoAspect } from '../src/features/editor/photo-aspect-ratio'

describe('photo aspect groups', () => {
  it('groups common ratios with a tolerance for real photo dimensions', () => {
    expect(classifyPhotoAspect(2048, 1362)).toBe('3:2')
    expect(classifyPhotoAspect(1600, 1200)).toBe('4:3')
    expect(classifyPhotoAspect(1920, 1080)).toBe('16:9')
    expect(classifyPhotoAspect(1200, 1200)).toBe('1:1')
  })

  it('keeps portrait and landscape groups distinct and applies EXIF rotation', () => {
    expect(classifyPhotoAspect(1200, 1800)).toBe('2:3')
    expect(classifyPhotoAspect(1800, 1200, 6)).toBe('2:3')
  })

  it('keeps uncommon ratios independent and safely handles invalid dimensions', () => {
    expect(classifyPhotoAspect(2000, 1000)).toMatch(/^other:/)
    expect(classifyPhotoAspect(0, 1000)).toBe('other:unknown')
  })
})
