import { describe, expect, test } from 'vitest'
import { findTextGuides } from '../src/features/text/text-guides'
import {
  applyMetadataCorrection, createTextElement, getEffectiveMetadata, getTextAnchorPosition, isValidCorrectionPattern,
  resolveTemplate, resolveTextLayers,
} from '../src/features/text/text-model'
import type { MetadataCorrectionRule } from '../src/features/text/text-model'
import type { FrameSettings, SessionPhoto } from '../src/types/photo'

const frame: FrameSettings = {
  style: 'white', top: 4, bottom: 10, left: 4, right: 4,
  linkSides: true, linkVertical: false, blurStrength: 16, backgroundBrightness: 100,
  showInset: false, showShadow: false,
}
const photo: SessionPhoto = {
  id: 'photo-1', name: 'Example.jpg', source: { kind: 'path', path: '/tmp/Example.jpg', url: '' },
  selected: true, completed: false, metadataState: 'ready', overrides: {},
  metadata: { camera: 'NIKON Z 6_2', lens: '70-300mm F/4.5-6.3', iso: '100' },
}
const rule = (mode: MetadataCorrectionRule['mode'], pattern: string, replacement: string): MetadataCorrectionRule =>
  ({ id: pattern, mode, pattern, replacement })

describe('metadata corrections and text export', () => {
  test('global corrections apply to the original and per-photo overrides take precedence', () => {
    const corrections = {
      camera: [rule('exact', 'NIKON Z 6_2', 'Nikon Z6 II')],
      lens: [rule('partial', '70-300mm', 'TAMRON 70–300 mm')],
    }
    expect(getEffectiveMetadata(photo, corrections)).toMatchObject({
      camera: 'Nikon Z6 II',
      lens: 'TAMRON 70–300 mm F/4.5-6.3',
    })
    const edited = { ...photo, metadataOverrides: { camera: 'My Nikon' } }
    expect(getEffectiveMetadata(edited, corrections).camera).toBe('My Nikon')
    expect(photo.metadata.camera).toBe('NIKON Z 6_2')
  })

  test('regex captures substitute only the matching part and invalid rules are ignored', () => {
    expect(isValidCorrectionPattern('regex', '(')).toBe(false)
    expect(applyMetadataCorrection(photo.metadata.camera, [
      rule('regex', '(', 'invalid'),
      rule('regex', 'Z (\\d)_([0-9])', 'Z$1 II'),
    ])).toBe('NIKON Z6 II')
  })

  test('a missing variable removes the whole layer from the final composition', () => {
    const incomplete = createTextElement('Shot on {camera} at {focal_length}')
    expect(resolveTemplate(incomplete.template, photo.metadata).missing).toEqual(['focalLength'])
    const textElements = [
      incomplete,
      { ...createTextElement('ISO {iso}'), anchor: 'bottom-right' as const, x: -30, y: -22 },
      { ...createTextElement('Not visible'), visible: false },
    ]
    expect(resolveTextLayers(photo, { ...frame, textElements })).toMatchObject([
      { text: 'ISO 100', anchor: 'bottom-right', x: -30, y: -22, color: '#000000' },
    ])
  })

  test('photo-relative anchors and opacity reach the export text recipe with legacy-safe defaults', () => {
    const oldText = createTextElement('{camera}')
    const watermarked = { ...createTextElement('{camera} · ISO {iso}'), anchorMode: 'photo' as const, opacity: 42 }
    const resolved = resolveTextLayers(photo, { ...frame, textElements: [oldText, watermarked] })
    expect(resolved).toMatchObject([
      { anchorMode: 'canvas', opacity: 100 },
      { anchorMode: 'photo', opacity: 42, text: 'NIKON Z 6_2 · ISO 100' },
    ])
  })

  test('EXIF templates resolve independently for each photo', () => {
    const template = { ...createTextElement('{camera} · ISO {iso}'), anchorMode: 'photo' as const }
    const first = resolveTextLayers(photo, { ...frame, textElements: [template] })
    const secondPhoto = { ...photo, id: 'photo-2', metadata: { camera: 'FUJIFILM X-T5', iso: '400' } }
    const second = resolveTextLayers(secondPhoto, { ...frame, textElements: [template] })
    expect(first[0].text).toBe('NIKON Z 6_2 · ISO 100')
    expect(second[0].text).toBe('FUJIFILM X-T5 · ISO 400')
  })

  test('anchor positions are fractions of the full canvas', () => {
    expect(getTextAnchorPosition('bottom-right')).toEqual([1, 1])
    expect(getTextAnchorPosition('center')).toEqual([0.5, 0.5])
  })
})

describe('text smart guides', () => {
  const canvas = { x: 0, y: 0, width: 300, height: 330 }

  test('snaps the moving edge to the visible photo edge', () => {
    const visiblePhoto = { x: 25, y: 15, width: 250, height: 295 }
    const guides = findTextGuides({ x: 26, y: 165, width: 28, height: 11 }, [], canvas, visiblePhoto)
    expect(guides.horizontal).toEqual({ shift: -1, guide: 25 })
  })

  test('snaps neighboring text to equal gaps', () => {
    const bounds = [
      { x: 25, y: 20, width: 16, height: 10 },
      { x: 65, y: 20, width: 16, height: 10 },
    ]
    const guides = findTextGuides({ x: 107, y: 20, width: 16, height: 10 }, bounds, canvas, undefined)
    expect(guides.horizontal).toEqual({ shift: -2, guide: 105 })
  })
})
