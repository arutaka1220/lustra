import { invoke, isTauri } from '@tauri-apps/api/core'
import exifr from 'exifr'
import type { ImportCandidate, MetadataReadStatus, PhotoMetadata } from '../../types/photo'

export type PhotoMetadataReadResult = {
  metadata: PhotoMetadata
  status: MetadataReadStatus
  diagnostics?: string[]
  imageWidth?: number
  imageHeight?: number
}

async function readDisplayDimensions(url: string): Promise<{ imageWidth?: number; imageHeight?: number }> {
  if (!url || typeof Image === 'undefined' || (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom'))) return {}
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0
      ? { imageWidth: image.naturalWidth, imageHeight: image.naturalHeight }
      : {})
    image.onerror = () => resolve({})
    image.src = url
  })
}

function captureDate(value: unknown, subsecond: unknown, offset: unknown): string | undefined {
  let date: string | undefined
  if (typeof value === 'string') date = value.trim()
  else if (value instanceof Date && Number.isFinite(value.getTime())) {
    const pad = (part: number) => String(part).padStart(2, '0')
    date = `${value.getFullYear()}:${pad(value.getMonth() + 1)}:${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  }
  if (!date) return undefined
  if (!/[.,]\d+/.test(date) && typeof subsecond === 'string' && /^\d+$/.test(subsecond.trim())) date += `.${subsecond.trim()}`
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) && typeof offset === 'string' && /^[+-]\d{2}:?\d{2}$/.test(offset.trim())) date += offset.trim()
  return date
}

export async function readPhotoMetadata(candidate: ImportCandidate): Promise<PhotoMetadataReadResult> {
  if (candidate.source.kind === 'path' && isTauri()) {
    const [result, dimensions] = await Promise.all([
      invoke<PhotoMetadataReadResult>('read_photo_metadata', { path: candidate.source.path }),
      readDisplayDimensions(candidate.source.url),
    ])
    return { ...result, ...dimensions }
  }
  if (candidate.source.kind !== 'file') return { metadata: {}, status: 'fileError' }

  const dimensionsPromise = readDisplayDimensions(candidate.source.url)
  try {
    const data = await exifr.parse(candidate.source.file, {
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'DateTimeOriginal', 'DateCreated', 'CreateDate', 'SubSecTimeOriginal', 'OffsetTimeOriginal', 'FNumber', 'ExposureTime', 'ISO', 'PhotographicSensitivity'],
      tiff: true,
      exif: true,
      xmp: true,
      reviveValues: false,
    })
    if (!data) return { metadata: {}, status: 'missing', ...await dimensionsPromise }

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
      date: captureDate(data.DateTimeOriginal ?? data.DateCreated ?? data.CreateDate, data.SubSecTimeOriginal, data.OffsetTimeOriginal),
    }
    const presentCount = Object.values(metadata).filter(Boolean).length
    const complete = Boolean(metadata.camera && metadata.lens && metadata.focalLength && metadata.aperture && metadata.iso && metadata.date)
    const dimensions = await dimensionsPromise
    return { metadata, status: complete ? 'complete' : presentCount ? 'partial' : 'missing', ...dimensions }
  } catch (error) {
    return {
      metadata: {},
      status: 'parseError',
      diagnostics: [error instanceof Error ? error.message : String(error)],
      ...await dimensionsPromise,
    }
  }
}
