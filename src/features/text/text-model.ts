import type { FrameSettings, PhotoMetadata, SessionPhoto } from '../../types/photo'
import { canvasUnit, FRAME_COLORS, getBackgroundRect } from '../editor/frame-layout'
import type { PhotoRaster } from '../editor/frame-paint'
import { formatCaptureDate } from './date-format'

export const TEXT_REFERENCE_SIZE = 1080
export const DEFAULT_TEXT_FONT = 'Arial'
export const TEXT_LINE_HEIGHT = 1.2

export const TEXT_ANCHORS = [
  'top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right',
] as const

export type TextAnchor = (typeof TEXT_ANCHORS)[number]
export type TextAnchorMode = 'photo' | 'canvas'
export type MetadataField = keyof PhotoMetadata

export type TextElement = {
  id: string
  template: string
  anchor: TextAnchor
  anchorMode?: TextAnchorMode
  x: number
  y: number
  size: number
  fontFamily: string
  weight: number
  color: 'auto' | string
  opacity?: number
  /** Last accepted custom color is retained while Auto is selected. */
  customColor?: string
  visible: boolean
  groupId?: string
}

export type TextDrawRecipe = Pick<TextElement, 'anchor' | 'anchorMode' | 'x' | 'y' | 'size' | 'fontFamily' | 'weight' | 'color' | 'opacity'> & { text: string }
export type MetadataCorrectionMode = 'exact' | 'partial' | 'regex'
export type MetadataCorrectionRule = { id: string; mode: MetadataCorrectionMode; pattern: string; replacement: string }
export type MetadataCorrectionsState = { camera: MetadataCorrectionRule[]; lens: MetadataCorrectionRule[] }

export const EMPTY_METADATA_CORRECTIONS: MetadataCorrectionsState = { camera: [], lens: [] }

export const METADATA_VARIABLES = {
  camera: 'camera',
  lens: 'lens',
  focal_length: 'focalLength',
  date: 'date',
  aperture: 'aperture',
  shutter_speed: 'shutterSpeed',
  iso: 'iso',
} as const satisfies Record<string, MetadataField>

const anchorPositions: Record<TextAnchor, [number, number]> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  center: [0.5, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
}

export function getTextAnchorPosition(anchor: TextAnchor): [number, number] {
  return anchorPositions[anchor]
}

export function createTextElement(template: string, id: string = crypto.randomUUID()): TextElement {
  return {
    id, template, anchor: 'bottom-left', x: 34, y: -18, size: 20,
    fontFamily: DEFAULT_TEXT_FONT, weight: 400, color: 'auto', visible: true,
  }
}

export const DEFAULT_TEXT_ELEMENTS: TextElement[] = [
  { ...createTextElement('{camera}', 'camera'), y: -53, size: 26, weight: 700 },
  { ...createTextElement('{lens}', 'lens'), y: -23 },
  { ...createTextElement('{focal_length}', 'focal-length'), anchor: 'bottom-right', x: -34, y: -53, size: 18 },
  { ...createTextElement('{date}', 'date'), anchor: 'bottom-right', x: -34, y: -23, size: 18 },
]

export function getTextElements(frame: FrameSettings) {
  return frame.textElements ?? DEFAULT_TEXT_ELEMENTS
}

export function isValidCorrectionPattern(mode: MetadataCorrectionMode, pattern: string) {
  if (!pattern.trim()) return false
  if (mode !== 'regex') return true
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function applyMetadataCorrection(value: string | undefined, rules: MetadataCorrectionRule[]) {
  if (!value) return undefined
  for (const { mode, pattern, replacement } of rules) {
    if (!pattern) continue
    if (mode === 'exact' && value === pattern) return replacement
    if (mode === 'partial' && value.includes(pattern)) return value.replaceAll(pattern, () => replacement)
    if (mode === 'regex') {
      try {
        const expression: RegExp = new RegExp(pattern)
        if (expression.test(value)) return value.replace(expression, replacement)
      } catch {
        // An invalid stored expression has no effect on the photo.
      }
    }
  }
  return value
}

export function getEffectiveMetadata(photo: SessionPhoto, corrections: MetadataCorrectionsState = EMPTY_METADATA_CORRECTIONS): PhotoMetadata {
  const metadata = {
    ...photo.metadata,
    camera: applyMetadataCorrection(photo.metadata.camera, corrections.camera),
    lens: applyMetadataCorrection(photo.metadata.lens, corrections.lens),
  }
  for (const field of Object.values(METADATA_VARIABLES)) {
    const override = photo.metadataOverrides?.[field]
    if (override !== undefined) metadata[field] = override
  }
  return metadata
}

export function resolveTemplate(template: string, metadata: PhotoMetadata, locale = 'en') {
  const missing = new Set<MetadataField>()
  const text = template.replace(/\{([a-z_]+)\}/gi, (token: string, variable: string) => {
    const key = variable.toLowerCase()
    if (!Object.hasOwn(METADATA_VARIABLES, key)) return token
    const field = METADATA_VARIABLES[key as keyof typeof METADATA_VARIABLES]
    const rawValue = metadata[field]?.trim()
    const value = field === 'date' ? formatCaptureDate(rawValue, locale) : rawValue
    if (!value) missing.add(field)
    return value ?? ''
  })
  return { text, missing: [...missing] }
}

export function textColor(color: TextElement['color'], style: FrameSettings['style'], customFrameColor?: string, blurredColor?: string) {
  if (color !== 'auto') return color
  const background = style === 'white' ? '#FFFFFF'
    : style === 'softWhite' ? '#FAFAF8'
      : style === 'softBlack' ? '#242424'
        : style === 'custom' ? customFrameColor ?? '#000000'
          : style === 'black' ? '#000000' : style === 'ambientGradient' ? '#777777' : blurredColor ?? '#454842'
  return bestContrastingTextColor(background)
}

/** Samples the local blurred backdrop under a text anchor without decoding the source again. */
export function sampleBlurredTextBackground(raster: PhotoRaster, frame: FrameSettings, size: { width: number; height: number }, element: TextElement): string {
  const sigma = frame.blurStrength * canvasUnit(size)
  const background = getBackgroundRect(size, raster, sigma)
  const [column, row] = getTextAnchorPosition(element.anchor)
  const scale = Math.min(size.width, size.height) / TEXT_REFERENCE_SIZE
  const x = Math.max(0, Math.min(size.width, column * size.width + element.x * scale))
  const y = Math.max(0, Math.min(size.height, row * size.height + element.y * scale))
  const sourceX = Math.max(0, Math.min(raster.width - 1, (x - background.x) / background.width * raster.width))
  const sourceY = Math.max(0, Math.min(raster.height - 1, (y - background.y) / background.height * raster.height))
  const sourceRadiusX = Math.max(1, sigma * 2 * raster.width / background.width)
  const sourceRadiusY = Math.max(1, sigma * 2 * raster.height / background.height)
  const left = Math.max(0, sourceX - sourceRadiusX)
  const top = Math.max(0, sourceY - sourceRadiusY)
  const right = Math.min(raster.width, sourceX + sourceRadiusX)
  const bottom = Math.min(raster.height, sourceY + sourceRadiusY)
  const sample = document.createElement('canvas')
  sample.width = sample.height = 1
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return FRAME_COLORS.blurred
  context.drawImage(raster.image, left, top, right - left, bottom - top, 0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  const brightness = (frame.backgroundBrightness ?? 100) / 100
  const opacity = (frame.backgroundOpacity ?? 100) / 100
  const matte = /^#?([\da-f]{6})$/i.exec(FRAME_COLORS.blurred)?.[1] ?? '454842'
  const matteChannels = [0, 2, 4].map((offset) => Number.parseInt(matte.slice(offset, offset + 2), 16))
  const channels = [r, g, b].map((value, index) => Math.round(value * brightness * opacity + matteChannels[index] * (1 - opacity)))
  return `#${channels.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`
}

export function bestContrastingTextColor(background: string): '#000000' | '#FFFFFF' {
  const hex = /^#?([\da-f]{6})$/i.exec(background)?.[1]
  if (!hex) return '#FFFFFF'
  const channel = (offset: number) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
}

export function getCanvasFontFamily(fontFamily: string) {
  // Quote a configured OS font as one family, then use the same fallback for all layers.
  const namedFamily = fontFamily.replace(/["\\\n\r\f]/g, '\\$&')
  return `"${namedFamily}", "${DEFAULT_TEXT_FONT}", "Noto Sans JP Variable", sans-serif`
}

export function resolveTextLayers(photo: SessionPhoto, frame: FrameSettings, corrections: MetadataCorrectionsState = EMPTY_METADATA_CORRECTIONS, locale = 'en', raster?: PhotoRaster, canvasSize?: { width: number; height: number }): TextDrawRecipe[] {
  const metadata = getEffectiveMetadata(photo, corrections)
  return getTextElements(frame).flatMap((element) => {
    if (!element.visible) return []
    const resolved = resolveTemplate(element.template, metadata, locale)
    if (resolved.missing.length || !resolved.text.trim()) return []
    const { anchor, anchorMode, x, y, size, fontFamily, weight, color, opacity } = element
    const blurred = color === 'auto' && frame.style === 'blurred' && raster && canvasSize
      ? sampleBlurredTextBackground(raster, frame, canvasSize, element)
      : undefined
    return [{ text: resolved.text, anchor, anchorMode: anchorMode ?? 'canvas', x, y, size, fontFamily, weight, color: textColor(color, frame.style, frame.customColor, blurred), opacity: opacity ?? 100 }]
  })
}
