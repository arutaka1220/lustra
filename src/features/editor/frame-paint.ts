import type { FrameSettings, PhotoCrop } from '../../types/photo'
import { canvasUnit, FRAME_COLORS, getBackgroundRect, getPhotoLayout } from './frame-layout'
import type { FrameRect, Size } from './frame-layout'

export type PhotoRaster = Size & { image: HTMLCanvasElement | HTMLImageElement }

export type FrameScene = {
  size: Size
  raster: PhotoRaster
  frame: FrameSettings
  layout: ReturnType<typeof getPhotoLayout>
  dpr: number
}

export interface PreviewRenderer {
  canvas: HTMLCanvasElement
  render(scene: FrameScene): void
  dispose(): void
}

export function createFrameScene(size: Size, raster: PhotoRaster, frame: FrameSettings, crop: PhotoCrop): FrameScene {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  return { size, raster, frame, layout: getPhotoLayout(size, raster, frame, crop), dpr }
}

/** Blur in bounded working space so the Canvas 2D path also works on WebKit without ctx.filter. */
function blurAndBrighten(ctx: CanvasRenderingContext2D, width: number, height: number, sigma: number, brightness: number) {
  if (sigma < 0.5 && brightness === 100) return
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  if (sigma >= 0.5) {
    const temporary = new Uint8ClampedArray(data.length)
    const radius = Math.max(1, Math.round(sigma))
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(data, temporary, width, height, 4, width * 4, radius)
      boxBlur(temporary, data, height, width, width * 4, 4, radius)
    }
  }
  if (brightness !== 100) {
    const multiplier = brightness / 100
    for (let i = 0; i < data.length; i += 4) {
      data[i] *= multiplier
      data[i + 1] *= multiplier
      data[i + 2] *= multiplier
    }
  }
  ctx.putImageData(image, 0, 0)
}

function boxBlur(
  input: Uint8ClampedArray,
  output: Uint8ClampedArray,
  lineLength: number,
  lineCount: number,
  pixelStride: number,
  lineStride: number,
  radius: number,
) {
  const diameter = radius * 2 + 1
  const last = lineLength - 1
  for (let line = 0; line < lineCount; line++) {
    const start = line * lineStride
    for (let channel = 0; channel < 4; channel++) {
      const base = start + channel
      let sum = input[base] * (radius + 1)
      for (let i = 1; i <= radius; i++) sum += input[base + Math.min(last, i) * pixelStride]
      for (let i = 0; i < lineLength; i++) {
        output[base + i * pixelStride] = sum / diameter
        sum += input[base + Math.min(last, i + radius + 1) * pixelStride]
        sum -= input[base + Math.max(0, i - radius) * pixelStride]
      }
    }
  }
}

function paintBlurredBackground(context: CanvasRenderingContext2D, scene: FrameScene) {
  const { size, raster, frame, dpr } = scene
  const scale = Math.min(dpr, 640 / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const sigma = frame.blurStrength * canvasUnit(size)
  const background = getBackgroundRect(size, raster, sigma)
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  const layer = image.getContext('2d', { willReadFrequently: true })
  if (!layer) return

  layer.fillStyle = FRAME_COLORS.blurred
  layer.fillRect(0, 0, width, height)
  const sx = width / size.width
  const sy = height / size.height
  layer.drawImage(raster.image, background.x * sx, background.y * sy, background.width * sx, background.height * sy)
  blurAndBrighten(layer, width, height, sigma * scale, frame.backgroundBrightness)
  context.save()
  context.globalAlpha = (frame.backgroundOpacity ?? 100) / 100
  context.drawImage(image, 0, 0, size.width, size.height)
  context.restore()
}

/** Shared backdrop keeps both preview paths identical without rerendering blur on crop movement. */
export class FrameBackdrop {
  readonly canvas = document.createElement('canvas')
  private key = ''
  private raster: PhotoRaster | undefined

  update(scene: FrameScene): boolean {
    const { size, raster, frame, layout, dpr } = scene
    const { visible } = layout
    const key = [size.width, size.height, dpr, frame.style, frame.blurStrength, frame.backgroundBrightness,
      frame.backgroundOpacity, frame.showShadow, visible.x, visible.y, visible.width, visible.height].join(':')
    if (this.raster === raster && this.key === key) return false

    const canvas = this.canvas
    canvas.width = Math.max(1, Math.round(size.width * dpr))
    canvas.height = Math.max(1, Math.round(size.height * dpr))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return false
    this.raster = raster
    this.key = key

    context.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0)
    context.fillStyle = FRAME_COLORS[frame.style]
    context.fillRect(0, 0, size.width, size.height)
    if (frame.style === 'blurred' && (frame.backgroundOpacity ?? 100) > 0) paintBlurredBackground(context, scene)
    if (frame.showShadow) {
      const unit = canvasUnit(size)
      context.save()
      context.beginPath()
      context.rect(0, 0, size.width, size.height)
      context.rect(visible.x, visible.y, visible.width, visible.height)
      context.clip('evenodd')
      context.shadowBlur = 16 * unit * dpr
      context.shadowOffsetY = 4 * unit * dpr
      context.shadowColor = 'rgba(0, 0, 0, .30)'
      context.fillStyle = 'black'
      context.fillRect(visible.x, visible.y, visible.width, visible.height)
      context.restore()
    }
    return true
  }
}

export function getInsetStroke(scene: FrameScene) {
  const { size, frame, layout: { visible } } = scene
  const weight = canvasUnit(size)
  const offset = 7 * weight
  const rect: FrameRect = {
    x: visible.x + offset,
    y: visible.y + offset,
    width: Math.max(0, visible.width - 2 * offset),
    height: Math.max(0, visible.height - 2 * offset),
  }
  return frame.style === 'white'
    ? { rect, weight, color: 0x181916, alpha: 0.38, cssColor: 'rgba(24, 25, 22, .38)' }
    : { rect, weight, color: 0xffffff, alpha: 0.6, cssColor: 'rgba(255, 255, 255, .60)' }
}

export function createCanvasRenderer(): PreviewRenderer {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  const backdrop = new FrameBackdrop()
  return {
    canvas,
    render(scene) {
      if (!context) return
      const { raster, size, dpr, frame, layout: { image, visible } } = scene
      const width = Math.max(1, Math.round(size.width * dpr))
      const height = Math.max(1, Math.round(size.height * dpr))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      backdrop.update(scene)
      context.setTransform(width / size.width, 0, 0, height / size.height, 0, 0)
      context.drawImage(backdrop.canvas, 0, 0, size.width, size.height)
      context.save()
      context.beginPath()
      context.rect(visible.x, visible.y, visible.width, visible.height)
      context.clip()
      context.drawImage(raster.image, image.x, image.y, image.width, image.height)
      if (frame.showInset) {
        const { rect, weight, cssColor } = getInsetStroke(scene)
        context.lineWidth = weight
        context.strokeStyle = cssColor
        context.strokeRect(rect.x, rect.y, rect.width, rect.height)
      }
      context.restore()
    },
    dispose() { canvas.remove() },
  }
}
