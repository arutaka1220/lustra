export type CropRatio = 'original' | 'free' | '1:1' | '3:2' | '4:3' | '16:9' | '9:16' | 'custom'
export type CropRect = { x: number; y: number; width: number; height: number; rotation?: number; ratio?: CropRatio; locked?: boolean; customRatio?: number }
export type CroppableRaster = { image: HTMLCanvasElement | HTMLImageElement; width: number; height: number }

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 }
const RATIO: Record<Exclude<CropRatio, 'free' | 'custom'>, number> = {
  original: 1, '1:1': 1, '3:2': 3 / 2, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16,
}

export function validCrop(value?: Partial<CropRect>): CropRect {
  const x = clamp(Number(value?.x) || 0, 0, 0.999)
  const y = clamp(Number(value?.y) || 0, 0, 0.999)
  return { x, y, width: clamp(Number(value?.width) || 1, 0.001, 1 - x), height: clamp(Number(value?.height) || 1, 0.001, 1 - y) }
}

export function ratioValue(ratio: CropRatio, sourceWidth: number, sourceHeight: number, custom = 1): number | undefined {
  if (ratio === 'free') return undefined
  if (ratio === 'custom') return Number.isFinite(custom) && custom > 0 ? custom : 1
  return ratio === 'original' ? sourceWidth / Math.max(sourceHeight, 1) : RATIO[ratio]
}

export function resizeCrop(crop: CropRect, handle: string, dx: number, dy: number, lockedRatio?: number): CropRect {
  const min = 0.01
  let left = crop.x, right = crop.x + crop.width, top = crop.y, bottom = crop.y + crop.height
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min)
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1)
  if (lockedRatio && Number.isFinite(lockedRatio) && lockedRatio > 0) {
    const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
    const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
    const useWidth = horizontal !== 0 && (vertical === 0 || Math.abs(dx) >= Math.abs(dy))
    let width = useWidth ? (right - left) : (bottom - top) * lockedRatio
    let height = width / lockedRatio
    const anchorX = horizontal > 0 ? crop.x : horizontal < 0 ? crop.x + crop.width : crop.x + crop.width / 2
    const anchorY = vertical > 0 ? crop.y : vertical < 0 ? crop.y + crop.height : crop.y + crop.height / 2
    const maxWidthX = horizontal > 0 ? 1 - anchorX : horizontal < 0 ? anchorX : 2 * Math.min(anchorX, 1 - anchorX)
    const maxHeightY = vertical > 0 ? 1 - anchorY : vertical < 0 ? anchorY : 2 * Math.min(anchorY, 1 - anchorY)
    const fitScale = Math.min(1, maxWidthX / width, maxHeightY / height)
    width = Math.max(min, width * fitScale); height = Math.max(min, height * fitScale)
    left = horizontal > 0 ? anchorX : horizontal < 0 ? anchorX - width : anchorX - width / 2
    top = vertical > 0 ? anchorY : vertical < 0 ? anchorY - height : anchorY - height / 2
    right = left + width; bottom = top + height
  }
  return { ...crop, x: left, y: top, width: right - left, height: bottom - top }
}

export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) }
}

export function fitCropRatio(crop: CropRect, sourceWidth: number, sourceHeight: number, ratio: number): CropRect {
  if (!Number.isFinite(ratio) || ratio <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return crop
  const normalizedRatio = ratio * sourceHeight / sourceWidth
  const width = Math.min(crop.width, crop.height * normalizedRatio)
  const height = width / normalizedRatio
  const cx = crop.x + crop.width / 2, cy = crop.y + crop.height / 2
  const x = clamp(cx - width / 2, 0, 1 - width), y = clamp(cy - height / 2, 0, 1 - height)
  return { ...crop, x, y, width, height }
}

export function applyCropToRaster(source: CroppableRaster, crop: CropRect): CroppableRaster {
  const rect = validCrop(crop)
  const width = Math.max(1, Math.round(source.width * rect.width))
  const height = Math.max(1, Math.round(source.height * rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return source
  const angle = ((Number.isFinite(crop.rotation) ? crop.rotation! : 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle))
  const scale = Math.max(width / (width * cos + height * sin), height / (height * cos + width * sin))
  context.imageSmoothingQuality = 'high'
  context.translate(width / 2, height / 2); context.rotate(angle); context.scale(scale, scale)
  context.drawImage(source.image, rect.x * source.width, rect.y * source.height, width, height, -width / 2, -height / 2, width, height)
  return { image: canvas, width, height }
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
