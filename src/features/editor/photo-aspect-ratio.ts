export type PhotoAspectGroup = '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '1:1' | `other:${string}`

const COMMON_RATIOS = [
  { key: '3:2', ratio: 3 / 2 }, { key: '2:3', ratio: 2 / 3 },
  { key: '4:3', ratio: 4 / 3 }, { key: '3:4', ratio: 3 / 4 },
  { key: '16:9', ratio: 16 / 9 }, { key: '9:16', ratio: 9 / 16 },
  { key: '1:1', ratio: 1 },
] as const

/** Uses display-oriented dimensions, after applying EXIF rotation when needed. */
export function classifyPhotoAspect(width: number, height: number, orientation?: number): PhotoAspectGroup {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'other:unknown'
  const rotated = orientation !== undefined && orientation >= 5 && orientation <= 8
  const ratio = rotated ? height / width : width / height
  const match = COMMON_RATIOS.find(({ ratio: target }) => Math.abs(ratio / target - 1) <= 0.035)
  if (match) return match.key
  // Quantize to a stable per-photo key so unrelated uncommon ratios do not share settings.
  return `other:${Math.round(ratio * 10000)}`
}
