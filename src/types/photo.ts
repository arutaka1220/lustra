import type { TextElement } from '../features/text/text-model'

export type PhotoMetadata = {
  camera?: string
  lens?: string
  focalLength?: string
  date?: string
  aperture?: string
  shutterSpeed?: string
  iso?: string
}

export type MetadataReadStatus = 'complete' | 'partial' | 'missing' | 'parseError' | 'fileError'

export const PHOTO_METADATA_READER_VERSION = 1

export type PhotoSource =
  | { kind: 'path'; path: string; url: string; missing?: boolean }
  | { kind: 'file'; file: File; url: string }

export type FrameStyle = 'none' | 'black' | 'white' | 'softBlack' | 'softWhite' | 'blurred' | 'custom' | 'ambientGradient' | 'edgeStretch'

export type LinkedPaddingRestore = {
  vertical?: { top: number; bottom: number }
  horizontal?: { left: number; right: number }
}

export type AspectPadding = Pick<FrameSettings, 'top' | 'bottom' | 'left' | 'right' | 'linkSides' | 'linkVertical' | 'linkedPaddingRestore'>
export type AspectPaddingMap = Record<string, AspectPadding>

export type FrameSettings = {
  style: FrameStyle
  customColor?: string
  top: number
  bottom: number
  left: number
  right: number
  linkSides: boolean
  linkVertical: boolean
  /** Values to restore when a linked padding axis is unlinked. Omitted for legacy linked sessions. */
  linkedPaddingRestore?: LinkedPaddingRestore
  blurStrength: number
  backgroundBrightness: number
  backgroundOpacity?: number
  ambientIntensity?: number
  ambientSoftness?: number
  ambientBrightness?: number
  ambientColorSource?: 'fullImage' | 'edges'
  edgeStretchMode?: 'extend' | 'mirror'
  edgeStretchBlur?: number
  edgeStretchFade?: number
  showInset: boolean
  showShadow: boolean
  textElements?: TextElement[]
  /** Session-local shared padding presets, keyed by source photo aspect group. */
  aspectPadding?: AspectPaddingMap
}

export type ImportCandidate = {
  id: string
  name: string
  source: PhotoSource
  selected: boolean
  metadata: PhotoMetadata
  // `ready` and `error` are accepted for sessions written by older builds.
  metadataState: 'loading' | MetadataReadStatus | 'ready' | 'error'
  metadataReaderVersion?: number
  metadataDiagnostics?: string[]
  /** Display dimensions; browser image decoding applies EXIF orientation. */
  imageWidth?: number
  imageHeight?: number
}

export type SessionPhoto = ImportCandidate & {
  completed: boolean
  overrides: Partial<FrameSettings>
  metadataOverrides?: PhotoMetadata
  /** Non-destructive crop in EXIF-oriented source coordinates, normalized to [0, 1]. */
  cropTransform?: { x: number; y: number; width: number; height: number; rotation: number; ratio?: 'original' | 'free' | '1:1' | '3:2' | '4:3' | '16:9' | '9:16' | 'custom'; locked?: boolean; customRatio?: number }
}
