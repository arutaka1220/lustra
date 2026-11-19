import { invoke, isTauri } from '@tauri-apps/api/core'
import exifr from 'exifr'
import type { ImportCandidate, PhotoMetadata } from '../../types/photo'

export async function readPhotoMetadata(candidate: ImportCandidate): Promise<PhotoMetadata> {
  if (candidate.source.kind === 'path' && isTauri()) {
    return invoke<PhotoMetadata>('read_photo_metadata', { path: candidate.source.path })
  }
  if (candidate.source.kind !== 'file') return {}

  const data = await exifr.parse(candidate.source.file, {
    pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'DateTimeOriginal', 'FNumber', 'ExposureTime', 'ISO', 'PhotographicSensitivity'],
  })
  if (!data) return {}

  const make = typeof data.Make === 'string' ? data.Make.trim() : ''
  const model = typeof data.Model === 'string' ? data.Model.trim() : ''
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ')

  const aperture = data.FNumber
  const exposure = data.ExposureTime
  const iso = data.ISO ?? data.PhotographicSensitivity

  return {
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
}
