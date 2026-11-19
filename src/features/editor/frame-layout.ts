import type { CanvasRatio, FrameSettings, PhotoCrop } from '../../types/photo'

export type Size = { width: number; height: number }
export type FrameRect = Size & { x: number; y: number }

export const DEFAULT_CROP: PhotoCrop = { x: 0, y: 0, zoom: 1 }
export const MAX_CROP_ZOOM = 3

export const FRAME_COLORS = {
  black: '#191a18',
  white: '#fafaf8',
  blurred: '#454842',
} satisfies Record<FrameSettings['style'], string>

export const CANVAS_RATIOS: CanvasRatio[] = ['1:1', '4:5', '3:4', '9:16', '3:2', '16:9', 'auto', 'custom']

const ratios = { '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '9:16': 9 / 16, '3:2': 3 / 2, '16:9': 16 / 9 }

export function getCanvasRatio(frame: FrameSettings, source: Size | undefined): number {
  if (frame.ratio === 'auto') return source ? source.width / source.height : ratios['4:5']
  if (frame.ratio === 'custom') {
    const width = frame.ratioWidth || 1
    const height = frame.ratioHeight || 1
    return width / height
  }
  return ratios[frame.ratio] ?? ratios['4:5']
}

export function fitCanvasSize(available: Size, ratio: number): Size {
  const width = Math.min(available.width, available.height * ratio)
  return { width, height: width / ratio }
}

export function clampCrop(crop: PhotoCrop | undefined): PhotoCrop {
  if (!crop) return DEFAULT_CROP
  return {
    x: Math.min(1, Math.max(-1, crop.x)),
    y: Math.min(1, Math.max(-1, crop.y)),
    zoom: Math.min(MAX_CROP_ZOOM, Math.max(1, crop.zoom)),
  }
}

function centerRect(bounds: FrameRect, width: number, height: number): FrameRect {
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
}

export function getPhotoLayout(canvas: Size, source: Size, frame: FrameSettings, crop: PhotoCrop) {
  const padded: FrameRect = {
    x: canvas.width * frame.left / 100,
    y: canvas.height * frame.top / 100,
    width: canvas.width * (100 - frame.left - frame.right) / 100,
    height: canvas.height * (100 - frame.top - frame.bottom) / 100,
  }
  const xScale = padded.width / source.width
  const yScale = padded.height / source.height
  if (frame.fit === 'fit') {
    const scale = Math.min(xScale, yScale)
    const image = centerRect(padded, source.width * scale, source.height * scale)
    return { image, visible: image, overflowX: 0, overflowY: 0 }
  }

  const scale = Math.max(xScale, yScale) * crop.zoom
  const image = centerRect(padded, source.width * scale, source.height * scale)
  const overflowX = Math.max(0, (image.width - padded.width) / 2)
  const overflowY = Math.max(0, (image.height - padded.height) / 2)
  image.x -= crop.x * overflowX
  image.y -= crop.y * overflowY
  return { image, visible: padded, overflowX, overflowY }
}

export function getBackgroundRect(canvas: Size, source: Size, blurSigma: number): FrameRect {
  const extension = blurSigma * 2
  const scale = Math.max((canvas.width + extension * 2) / source.width, (canvas.height + extension * 2) / source.height)
  return centerRect({ ...canvas, x: 0, y: 0 }, source.width * scale, source.height * scale)
}

export function canvasUnit(canvas: Size): number {
  return Math.min(canvas.width, canvas.height) / 1080
}
