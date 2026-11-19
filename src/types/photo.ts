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

export type FrameStyle = 'black' | 'white' | 'blurred'

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
  // `ready` and `error` are accepted for sessions written by older builds.
  metadataState: 'loading' | MetadataReadStatus | 'ready' | 'error'
  metadataReaderVersion?: number
  metadataDiagnostics?: string[]
}

export type SessionPhoto = ImportCandidate & {
  completed: boolean
  overrides: Partial<FrameSettings>
  metadataOverrides?: PhotoMetadata
}
