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

export type PhotoSource =
  | { kind: 'path'; path: string; url: string; missing?: boolean }
  | { kind: 'file'; file: File; url: string }

export type FrameStyle = 'black' | 'white' | 'blurred'
export type CanvasRatio = '1:1' | '4:5' | '3:4' | '9:16' | '3:2' | '16:9' | 'auto' | 'custom'
export type FitMode = 'fit' | 'fill'
export type PhotoCrop = { x: number; y: number; zoom: number }

export type FrameSettings = {
  style: FrameStyle
  top: number
  bottom: number
  left: number
  right: number
  linkSides: boolean
  linkVertical: boolean
  blurStrength: number
  backgroundBrightness: number
  backgroundOpacity?: number
  ratio: CanvasRatio
  ratioWidth?: number
  ratioHeight?: number
  fit: FitMode
  showInset: boolean
  showShadow: boolean
  textElements?: TextElement[]
}

export type ImportCandidate = {
  id: string
  name: string
  source: PhotoSource
  selected: boolean
  metadata: PhotoMetadata
  metadataState: 'loading' | 'ready' | 'missing' | 'error'
}

export type SessionPhoto = ImportCandidate & {
  completed: boolean
  overrides: Partial<FrameSettings>
  crop?: PhotoCrop
  metadataOverrides?: PhotoMetadata
}
