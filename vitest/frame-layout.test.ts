import { describe, expect, test } from 'vitest'
import { canvasAspectRatio, getPhotoLayout } from '../src/features/editor/frame-layout'
import { hasLegacyCanvasSettings, withoutLegacyCanvasSettings } from '../src/features/editor/frame-migration'
import type { FrameSettings } from '../src/types/photo'

const frame = (changes: Partial<FrameSettings> = {}): FrameSettings => ({
  style: 'white',
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  linkSides: true,
  linkVertical: false,
  blurStrength: 18,
  backgroundBrightness: 100,
  showInset: false,
  showShadow: false,
  ...changes,
})

describe('padding based canvas layout', () => {
  test('None keeps the source canvas ratio and places the image edge to edge', () => {
    const source = { width: 1600, height: 900 }
    const settings = frame({ style: 'none', top: 12, bottom: 8, left: 10, right: 10 })
    const canvas = { width: 1600, height: 900 }
    expect(canvasAspectRatio(settings, source)).toBeCloseTo(1600 / 900)
    expect(getPhotoLayout(canvas, source, settings)).toEqual({
      image: { x: 0, y: 0, width: 1600, height: 900 },
      visible: { x: 0, y: 0, width: 1600, height: 900 },
      overflowX: 0,
      overflowY: 0,
    })
  })
  test('migrates presets by removing old ratio and fit keys while retaining design settings', () => {
    const legacyPreset = {
      ...frame({ top: 8, bottom: 22, left: 12, right: 12, style: 'white' }),
      ratio: '4:5',
      ratioWidth: 4,
      ratioHeight: 5,
      fit: 'fill',
      textElements: [{ id: 'camera', text: '{camera}', x: 0.2, y: 0.8 }],
    }
    expect(hasLegacyCanvasSettings(legacyPreset)).toBe(true)

    const migrated = withoutLegacyCanvasSettings(legacyPreset)
    expect(migrated).toMatchObject({ top: 8, bottom: 22, left: 12, right: 12, style: 'white' })
    expect(migrated.textElements).toEqual(legacyPreset.textElements)
    expect(migrated).not.toHaveProperty('ratio')
    expect(migrated).not.toHaveProperty('ratioWidth')
    expect(migrated).not.toHaveProperty('ratioHeight')
    expect(migrated).not.toHaveProperty('fit')
  })

  test('canvas ratio follows the source aspect ratio and the independent padding edges', () => {
    const source = { width: 900, height: 1600 }
    const settings = frame({ left: 10, bottom: 20 })
    expect(canvasAspectRatio(settings, source)).toBeCloseTo((900 / 1600) * 0.8 / 0.9)
  })

  test('places the complete source image inside padding without cropping or stretching', () => {
    const source = { width: 900, height: 1600 }
    const settings = frame({ left: 10, bottom: 20 })
    const canvas = { width: 1000, height: 2000 }
    const layout = getPhotoLayout(canvas, source, settings)

    expect(layout.image.width / layout.image.height).toBeCloseTo(source.width / source.height)
    expect(layout.image.x).toBeCloseTo(100)
    expect(layout.image.y).toBeCloseTo(0)
    expect(layout.image.x + layout.image.width).toBeLessThanOrEqual(canvas.width)
    expect(layout.image.y + layout.image.height).toBeLessThanOrEqual(canvas.height)
    expect(layout.visible).toEqual(layout.image)
    expect(layout.overflowX).toBe(0)
    expect(layout.overflowY).toBe(0)
  })

  test('keeps the canvas ratio while fitting a differently cropped image for Frame None', () => {
    const layout = getPhotoLayout({ width: 300, height: 200 }, { width: 100, height: 100 }, frame({ style: 'none' }))
    expect(layout.image).toEqual({ x: 50, y: 0, width: 200, height: 200 })
    expect(layout.visible).toEqual(layout.image)
  })

  test('padding changes the completed canvas ratio without changing the photo ratio', () => {
    const source = { width: 900, height: 1600 }
    const settings = frame({ left: 10, bottom: 20 })
    const canvas = { width: source.width / 0.9, height: source.height / 0.8 }
    const layout = getPhotoLayout(canvas, source, settings)

    expect(canvas.width / canvas.height).toBeCloseTo(canvasAspectRatio(settings, source))
    expect(layout.image.width / layout.image.height).toBeCloseTo(source.width / source.height)
    expect(layout.image.width).toBeCloseTo(source.width)
    expect(layout.image.height).toBeCloseTo(source.height)
  })
})
