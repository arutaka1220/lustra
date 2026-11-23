import type { FrameSettings } from '../../types/photo'

export type Size = { width: number; height: number }
export type FrameRect = Size & { x: number; y: number }

export const FRAME_COLORS = {
  none: '#000000',
  black: '#000000',
  white: '#FFFFFF',
  softBlack: '#242424',
  softWhite: '#fafaf8',
  blurred: '#454842',
  edgeStretch: '#454842',
  custom: '#000000',
  ambientGradient: '#777777',
} satisfies Record<FrameSettings['style'], string>

export function effectiveFrameSettings(frame: FrameSettings): FrameSettings {
  if (frame.canvasLayout !== 'portraitCard') return frame
  return { ...frame, style: frame.portraitBackgroundStyle ?? 'blurred', customColor: frame.portraitBackgroundCustomColor ?? '#000000', blurStrength: frame.portraitBackgroundBlur ?? 32, backgroundBrightness: frame.portraitBackgroundBrightness ?? 90, top: 0, bottom: 0, left: 0, right: 0, showInset: false, showShadow: false }
}

function paddingFraction(value: number): number {
  return Math.min(49, Math.max(0, Number.isFinite(value) ? value : 0)) / 100
}

function innerFractions(frame: FrameSettings) {
  const left = paddingFraction(frame.left)
  const right = paddingFraction(frame.right)
  const top = paddingFraction(frame.top)
  const bottom = paddingFraction(frame.bottom)
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0.02, 1 - left - right),
    height: Math.max(0.02, 1 - top - bottom),
  }
}

/** The padding values are percentages of the completed canvas edge, as in legacy sessions. */
export function canvasAspectRatio(frame: FrameSettings, source?: Size): number {
  if (frame.canvasLayout === 'portraitCard') return frame.portraitRatio && Number.isFinite(frame.portraitRatio) && frame.portraitRatio > 0 ? Math.max(0.2, Math.min(5, frame.portraitRatio)) : 4 / 5
  if (frame.style === 'none') return source && source.width > 0 && source.height > 0 ? source.width / source.height : 4 / 5
  const inner = innerFractions(frame)
  const imageAspect = source && source.width > 0 && source.height > 0 ? source.width / source.height : 4 / 5
  return imageAspect * inner.height / inner.width
}

/** Scale a canvas into the available preview bounds without changing its aspect ratio. */
export function fitCanvasToBounds(available: Size, aspectRatio: number): Size {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 4 / 5
  const width = Math.min(available.width, available.height * ratio)
  return { width, height: width / ratio }
}

function centerRect(bounds: FrameRect, width: number, height: number): FrameRect {
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
}

/** Add padding around the complete, uncropped source image. */
export function getPhotoLayout(canvas: Size, source: Size, frame: FrameSettings) {
  if (frame.canvasLayout === 'portraitCard') {
    const width = canvas.width * Math.min(90, Math.max(40, frame.portraitPhotoSize ?? 80)) / 100
    const height = width * source.height / source.width
    const position = Math.max(-0.5, Math.min(0.5, frame.portraitVerticalPosition ?? 0))
    const centerY = canvas.height / 2 + position * (canvas.height + height) / 2
    const image = { x: (canvas.width - width) / 2, y: centerY - height / 2, width, height }
    const left = Math.max(0, image.x), top = Math.max(0, image.y)
    const right = Math.min(canvas.width, image.x + image.width), bottom = Math.min(canvas.height, image.y + image.height)
    const visible = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    return { image, visible, overflowX: 0, overflowY: 0 }
  }
  if (frame.style === 'none') {
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
    const image = centerRect({ ...canvas, x: 0, y: 0 }, source.width * scale, source.height * scale)
    return { image, visible: image, overflowX: 0, overflowY: 0 }
  }
  const fractions = innerFractions(frame)
  const padded: FrameRect = {
    x: canvas.width * fractions.left,
    y: canvas.height * fractions.top,
    width: canvas.width * fractions.width,
    height: canvas.height * fractions.height,
  }
  const scale = Math.min(padded.width / source.width, padded.height / source.height)
  const image = centerRect(padded, source.width * scale, source.height * scale)
  return { image, visible: image, overflowX: 0, overflowY: 0 }
}

export function getBackgroundRect(canvas: Size, source: Size, blurSigma: number): FrameRect {
  const extension = blurSigma * 2
  const scale = Math.max((canvas.width + extension * 2) / source.width, (canvas.height + extension * 2) / source.height)
  return centerRect({ ...canvas, x: 0, y: 0 }, source.width * scale, source.height * scale)
}

export function canvasUnit(canvas: Size): number {
  return Math.min(canvas.width, canvas.height) / 1080
}
