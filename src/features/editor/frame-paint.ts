import type { FrameSettings } from '../../types/photo'
import { canvasUnit, FRAME_COLORS, getBackgroundRect, getPhotoLayout } from './frame-layout'
import type { FrameRect, Size } from './frame-layout'
import { extractAmbientSamples } from './ambient-colors'
import { edgeFadeWeight, edgeSampleCoordinate } from './edge-stretch'

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

export function createFrameScene(size: Size, raster: PhotoRaster, frame: FrameSettings): FrameScene {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  return { size, raster, frame, layout: getPhotoLayout(size, raster, frame), dpr }
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

const ambientColorCache = new WeakMap<PhotoRaster, { source: string; samples: ReturnType<typeof extractAmbientSamples> }>()
function ambientColors(raster: PhotoRaster, source: 'fullImage' | 'edges') {
  const cached = ambientColorCache.get(raster)
  if (cached?.source === source) return cached.samples
  const sample = document.createElement('canvas')
  sample.width = sample.height = 96
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(raster.image, 0, 0, 96, 96)
  const { data } = ctx.getImageData(0, 0, 96, 96)
  const samples = extractAmbientSamples(data, 96, 96, source)
  ambientColorCache.set(raster, { source, samples })
  return samples
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgb.map(value => (value + m) * 255) as [number, number, number]
}

function paintAmbientBackground(context: CanvasRenderingContext2D, scene: FrameScene) {
  const { raster, frame, size } = scene
  const source = frame.ambientColorSource ?? 'fullImage'
  const samples = ambientColors(raster, source)
  const intensity = Math.max(0, Math.min(100, frame.ambientIntensity ?? 85)) / 100
  const softness = Math.max(0, Math.min(100, frame.ambientSoftness ?? 65)) / 100
  const brightness = Math.max(-100, Math.min(100, frame.ambientBrightness ?? 0))
  const layer = document.createElement('canvas')
  layer.width = layer.height = 256
  const ctx = layer.getContext('2d', { willReadFrequently: true })
  if (!ctx || !samples.length) return
  const image = ctx.createImageData(256, 256)
  const colors = samples.map(({ color, x, y, weight }) => {
    const m = color.match(/\d+/g)!.map(Number)
    return { ...rgbToHsv(m[0], m[1], m[2]), x, y, weight: Math.sqrt(Math.max(weight, 1 / 9216)) }
  })
  // Gaussian spatial interpolation preserves where each color belongs. Hue
  // vectors are blended separately from value/chroma to avoid RGB gray-out.
  const sigma = 0.16 + softness * 0.28
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const nx = px / 255, ny = py / 255
    let total = 0, value = 0, saturation = 0, hueTotal = 0, hueX = 0, hueY = 0
    let fallbackHue = 0, fallbackStrength = -1
    for (const sample of colors) {
      const dx = nx - sample.x, dy = ny - sample.y
      const w = sample.weight * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
      total += w; value += sample.v * w; saturation += sample.s * w
      const hueWeight = sample.s * w * w, radians = sample.h * Math.PI / 180
      hueTotal += hueWeight; hueX += Math.cos(radians) * hueWeight; hueY += Math.sin(radians) * hueWeight
      if (hueWeight > fallbackStrength) { fallbackStrength = hueWeight; fallbackHue = sample.h }
    }
    const i = (py * 256 + px) * 4
    const factor = brightness < 0 ? Math.max(0, 1 + brightness / 120) : 1
    const lift = brightness > 0 ? brightness * 1.36 : 0
    const vectorLength = Math.hypot(hueX, hueY)
    const hue = vectorLength / Math.max(1e-9, hueTotal) < 0.12 ? fallbackHue : (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360
    const v = Math.max(0, Math.min(1, (0.47 + (value / total - 0.47) * intensity) * factor + lift / 255))
    const s = Math.max(0, Math.min(0.96, saturation / total * intensity * (1 + intensity * 0.35)))
    const [r, g, b] = hsvToRgb(hue, s, v)
    image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b
    image.data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  context.drawImage(layer, 0, 0, size.width, size.height)
}

/** Builds a bounded nine-slice edge backdrop; the foreground photo is painted separately. */
function paintEdgeStretchBackground(context: CanvasRenderingContext2D, scene: FrameScene) {
  const { size, raster, frame, layout } = scene
  const scale = Math.min(1, 640 / Math.max(size.width, size.height))
  const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale))
  const layer = document.createElement('canvas'); layer.width = width; layer.height = height
  const ctx = layer.getContext('2d', { willReadFrequently: true }); if (!ctx) return
  const sx = width / size.width, sy = height / size.height
  const { visible, image } = layout
  ctx.drawImage(raster.image, image.x*sx, image.y*sy, image.width*sx, image.height*sy)
  const pixels = ctx.getImageData(0, 0, width, height)
  const input = new Uint8ClampedArray(pixels.data)
  const left = Math.max(0, Math.floor(visible.x*sx)), right = Math.min(width-1, Math.ceil((visible.x+visible.width)*sx)-1)
  const top = Math.max(0, Math.floor(visible.y*sy)), bottom = Math.min(height-1, Math.ceil((visible.y+visible.height)*sy)-1)
  const mode = frame.edgeStretchMode ?? 'extend'
  const fade = Math.max(0, Math.min(40, frame.edgeStretchFade ?? 12))*canvasUnit(size)*scale
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    if (x>=left && x<=right && y>=top && y<=bottom) continue
    const fx=edgeSampleCoordinate(x,left,right,mode), fy=edgeSampleCoordinate(y,top,bottom,mode)
    const ix=Math.max(left,Math.min(right,Math.round(fx))), iy=Math.max(top,Math.min(bottom,Math.round(fy)))
    const dist=Math.max(x<left?left-x:x>right?x-right:0,y<top?top-y:y>bottom?y-bottom:0)
    const weight=edgeFadeWeight(dist,fade)
    const fadeDepth=Math.max(1,Math.round(fade))
    const inwardX=Math.max(left,Math.min(right,Math.round(x<left?left+fadeDepth:x>right?right-fadeDepth:fx)))
    const inwardY=Math.max(top,Math.min(bottom,Math.round(y<top?top+fadeDepth:y>bottom?bottom-fadeDepth:fy)))
    const from=(iy*width+ix)*4, toward=(inwardY*width+inwardX)*4, to=(y*width+x)*4
    for(let c=0;c<4;c++) pixels.data[to+c]=input[from+c]*(1-weight)+input[toward+c]*weight
  }
  ctx.putImageData(pixels,0,0)
  const blur = Math.max(0, Math.min(40, frame.edgeStretchBlur ?? 8)) * canvasUnit(size) * scale
  blurAndBrighten(ctx, width, height, blur, 100)
  context.drawImage(layer, 0, 0, size.width, size.height)
}

/** Shared backdrop keeps both preview paths identical without rerendering blur on image movement. */
export class FrameBackdrop {
  readonly canvas = document.createElement('canvas')
  private key = ''
  private raster: PhotoRaster | undefined

  update(scene: FrameScene): boolean {
    const { size, raster, frame, layout, dpr } = scene
    const { visible } = layout
    const key = [size.width, size.height, dpr, frame.style, frame.customColor, frame.blurStrength, frame.backgroundBrightness,
      frame.backgroundOpacity, frame.ambientIntensity, frame.ambientSoftness, frame.ambientBrightness, frame.ambientColorSource,
      frame.edgeStretchMode, frame.edgeStretchBlur, frame.edgeStretchFade,
      frame.showShadow, visible.x, visible.y, visible.width, visible.height].join(':')
    if (this.raster === raster && this.key === key) return false

    const canvas = this.canvas
    canvas.width = Math.max(1, Math.round(size.width * dpr))
    canvas.height = Math.max(1, Math.round(size.height * dpr))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return false
    this.raster = raster
    this.key = key

    context.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0)
    context.fillStyle = frame.style === 'custom' ? (frame.customColor ?? '#000000') : FRAME_COLORS[frame.style]
    context.fillRect(0, 0, size.width, size.height)
    if (frame.style === 'blurred' && (frame.backgroundOpacity ?? 100) > 0) paintBlurredBackground(context, scene)
    if (frame.style === 'ambientGradient') paintAmbientBackground(context, scene)
    if (frame.style === 'edgeStretch') paintEdgeStretchBackground(context, scene)
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
  return frame.style === 'white' || frame.style === 'softWhite'
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
