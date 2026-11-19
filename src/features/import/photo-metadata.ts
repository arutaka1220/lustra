import { invoke, isTauri } from '@tauri-apps/api/core'
import exifr from 'exifr'
import type { ImportCandidate, MetadataReadStatus, PhotoMetadata } from '../../types/photo'

export type PhotoMetadataReadResult = {
  metadata: PhotoMetadata
  status: MetadataReadStatus
  diagnostics?: string[]
}

export async function readPhotoMetadata(candidate: ImportCandidate): Promise<PhotoMetadataReadResult> {
  if (candidate.source.kind === 'path' && isTauri()) {
    return invoke<PhotoMetadataReadResult>('read_photo_metadata', { path: candidate.source.path })
  }
  if (candidate.source.kind !== 'file') return { metadata: {}, status: 'fileError' }

  try {
    const data = await exifr.parse(candidate.source.file, {
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'DateTimeOriginal', 'FNumber', 'ExposureTime', 'ISO', 'PhotographicSensitivity'],
    })
    if (!data) return { metadata: {}, status: 'missing' }

    const make = typeof data.Make === 'string' ? data.Make.trim() : ''
    const model = typeof data.Model === 'string' ? data.Model.trim() : ''
    const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ')

    const aperture = data.FNumber
    const exposure = data.ExposureTime
    const iso = data.ISO ?? data.PhotographicSensitivity

    const metadata: PhotoMetadata = {
      camera: camera || undefined,
      lens: typeof data.LensModel === 'string' ? data.LensModel.trim() : undefined,
      focalLength: data.FocalLength != null ? `${data.FocalLength} mm` : undefined,
      aperture: typeof aperture === 'number' && aperture > 0 ? `f/${aperture}` : undefined,
      shutterSpeed: typeof exposure === 'number' && exposure > 0
        ? exposure > 0.5 ? `${exposure} s` : `1/${Math.round(1 / exposure)} s`
        : undefined,
      iso: typeof iso === 'number' && iso > 0 ? String(iso) : undefined,
      date: data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal.toLocaleString() : undefined,
    }
    const presentCount = Object.values(metadata).filter(Boolean).length
    const complete = Boolean(metadata.camera && metadata.lens && metadata.focalLength && metadata.aperture && metadata.iso && metadata.date)
    return { metadata, status: complete ? 'complete' : presentCount ? 'partial' : 'missing' }
  } catch (error) {
    return {
      metadata: {},
      status: 'parseError',
      diagnostics: [error instanceof Error ? error.message : String(error)],
    }
  }
}
