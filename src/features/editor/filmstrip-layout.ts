export const DEFAULT_FILMSTRIP_HEIGHT = 140
export const MIN_FILMSTRIP_HEIGHT = 100

export function maxFilmstripHeight(viewportHeight: number, editorHeight = viewportHeight): number {
  const previewMin = viewportHeight <= 620 ? 190 : viewportHeight <= 760 ? 230 : 280
  const viewportLimit = Math.floor(viewportHeight * 0.4)
  const availableLimit = Math.floor(editorHeight - previewMin - 50 - 1)
  return Math.max(MIN_FILMSTRIP_HEIGHT, Math.min(viewportLimit, availableLimit))
}

export function clampFilmstripHeight(height: number, viewportHeight: number, editorHeight = viewportHeight): number {
  const maximum = maxFilmstripHeight(viewportHeight, editorHeight)
  if (!Number.isFinite(height)) return Math.min(DEFAULT_FILMSTRIP_HEIGHT, maximum)
  return Math.max(MIN_FILMSTRIP_HEIGHT, Math.min(maximum, Math.round(height)))
}
