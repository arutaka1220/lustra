import type { FrameSettings, PhotoMetadata, SessionPhoto } from '../../types/photo'
import { formatCaptureDate } from './date-format'

export const TEXT_REFERENCE_SIZE = 1080
export const DEFAULT_TEXT_FONT = 'Arial'
export const TEXT_LINE_HEIGHT = 1.2

export const TEXT_ANCHORS = [
  'top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right',
] as const

export type TextAnchor = (typeof TEXT_ANCHORS)[number]
export type MetadataField = keyof PhotoMetadata

export type TextElement = {
  id: string
  template: string
  anchor: TextAnchor
  x: number
  y: number
  size: number
  fontFamily: string
  weight: number
  color: 'auto' | string
  visible: boolean
  groupId?: string
}

export type TextDrawRecipe = Pick<TextElement, 'anchor' | 'x' | 'y' | 'size' | 'fontFamily' | 'weight' | 'color'> & { text: string }
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

export function textColor(color: TextElement['color'], style: FrameSettings['style']) {
  return color === 'auto' ? (style === 'white' || style === 'softWhite' ? '#161616' : '#ffffff') : color
}

export function getCanvasFontFamily(fontFamily: string) {
  // Quote a configured OS font as one family, then use the same fallback for all layers.
  const namedFamily = fontFamily.replace(/["\\\n\r\f]/g, '\\$&')
  return `"${namedFamily}", "${DEFAULT_TEXT_FONT}", "Noto Sans JP Variable", sans-serif`
}

export function resolveTextLayers(photo: SessionPhoto, frame: FrameSettings, corrections: MetadataCorrectionsState = EMPTY_METADATA_CORRECTIONS, locale = 'en'): TextDrawRecipe[] {
  const metadata = getEffectiveMetadata(photo, corrections)
  return getTextElements(frame).flatMap((element) => {
    if (!element.visible) return []
    const resolved = resolveTemplate(element.template, metadata, locale)
    if (resolved.missing.length || !resolved.text.trim()) return []
    const { anchor, x, y, size, fontFamily, weight, color } = element
    return [{ text: resolved.text, anchor, x, y, size, fontFamily, weight, color: textColor(color, frame.style) }]
  })
}
