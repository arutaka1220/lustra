import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings, PhotoCrop, SessionPhoto } from '../../types/photo'
import { TextOverlay } from '../text/TextOverlay'
import { clampCrop, fitCanvasSize, getCanvasRatio, getPhotoLayout } from './frame-layout'
import type { FrameRect, Size } from './frame-layout'
import { createCanvasRenderer, createFrameScene } from './frame-paint'
import type { PhotoRaster, PreviewRenderer } from './frame-paint'
import './frame-i18n'
import '../../styles/frame-preview.css'

type FramePreviewProps = {
  photo: SessionPhoto
  frame: FrameSettings
  compact?: boolean
  readOnly?: boolean
  onCropChange?: (crop: PhotoCrop) => void
  onImageError?: () => void
  onRevealInspector?: () => void
}

type LoadedPhoto = { url: string; raster?: PhotoRaster; error?: boolean }
type CropDrag = {
  pointerId: number
  x: number
  y: number
  overflowX: number
  overflowY: number
  start: PhotoCrop
  next: PhotoCrop
}

function rasterizeImage(image: HTMLImageElement, maxEdge: number): PhotoRaster {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  if (scale === 1) return { image, width, height }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return { image, width, height }
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { image: canvas, width, height }
}

export function FramePreview({ photo, frame, compact = false, readOnly = false, onCropChange, onImageError, onRevealInspector }: FramePreviewProps) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const renderer = useRef<PreviewRenderer | null>(null)
  const fallback = useRef<(() => void) | null>(null)
  const animation = useRef(0)
  const cropDrag = useRef<CropDrag | null>(null)
  const [seen, setSeen] = useState(!compact)
  const [available, setAvailable] = useState<Size>({ width: 1, height: 1 })
  const [loaded, setLoaded] = useState<LoadedPhoto>()
  const sourceUrl = photo.source.url
  const status = loaded?.url === sourceUrl ? loaded : undefined
  const raster = status?.raster
  const sourceMissing = photo.source.kind === 'path' && photo.source.missing === true
  const size = fitCanvasSize(available, getCanvasRatio(frame, raster))
  const crop = clampCrop(photo.crop)
  const photoLayout = raster && getPhotoLayout(size, raster, frame, crop)
  const paintRef = useRef<(draftCrop?: PhotoCrop) => void>(() => {})
  const imageErrorRef = useRef(onImageError)

  const scheduleDraw = useCallback(() => {
    if (animation.current) return
    animation.current = window.requestAnimationFrame(() => {
      animation.current = 0
      paintRef.current(cropDrag.current?.next)
    })
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setAvailable({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!compact || !element) return
    const observer = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { rootMargin: '180px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [compact])

  useLayoutEffect(() => { imageErrorRef.current = onImageError }, [onImageError])

  useEffect(() => {
    if (!seen || sourceMissing || !sourceUrl) return
    let active = true
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (active) setLoaded({ url: sourceUrl, raster: rasterizeImage(image, compact ? 480 : 2048) })
    }
    image.onerror = () => {
      if (!active) return
      setLoaded({ url: sourceUrl, error: true })
      imageErrorRef.current?.()
    }
    image.src = sourceUrl
    return () => {
      active = false
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      if (compact) setLoaded(undefined)
    }
  }, [compact, seen, sourceMissing, sourceUrl])

  useEffect(() => {
    const mount = surface.current
    if (!mount || !seen) return
    let active = true
    let current = createCanvasRenderer()
    let gpuRenderer: PreviewRenderer | null = null
    const install = (next: PreviewRenderer) => {
      current = next
      renderer.current = next
      mount.replaceChildren(next.canvas)
      scheduleDraw()
    }
    const useFallback = () => {
      if (current !== gpuRenderer || !gpuRenderer) return
      gpuRenderer.dispose()
      gpuRenderer = null
      install(createCanvasRenderer())
    }
    fallback.current = useFallback
    install(current)

    if (!compact) {
      void import('./pixi-frame').then(({ createPixiRenderer }) => createPixiRenderer()).then((gpu) => {
        if (!active) {
          gpu.dispose()
          return
        }
        gpuRenderer = gpu
        gpu.canvas.addEventListener('webglcontextlost', useFallback, { once: true })
        current.dispose()
        install(gpu)
      }).catch(() => { /* Canvas 2D already owns the surface when WebGL initialization fails. */ })
    }

    return () => {
      active = false
      window.cancelAnimationFrame(animation.current)
      animation.current = 0
      renderer.current = null
      fallback.current = null
      current.dispose()
    }
  }, [compact, scheduleDraw, seen])

  useLayoutEffect(() => {
    paintRef.current = (draftCrop) => {
      if (!raster || !seen || sourceMissing || !renderer.current) return
      const scene = createFrameScene(size, raster, frame, draftCrop ?? crop)
      try {
        renderer.current.render(scene)
      } catch {
        fallback.current?.()
      }
    }
    scheduleDraw()
  })

  useEffect(() => () => {
    if (cropDrag.current) delete document.documentElement.dataset.lustraPreviewDrag
    cropDrag.current = null
  }, [sourceUrl, photo.id])

  const startCropDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || cropDrag.current || !photoLayout || !onCropChange) return
    const { overflowX, overflowY } = photoLayout
    if (overflowX <= 0 && overflowY <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.classList.add('is-dragging')
    document.documentElement.dataset.lustraPreviewDrag = 'true'
    cropDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, overflowX, overflowY, start: crop, next: crop }
  }

  const moveCropDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = cropDrag.current
    if (drag?.pointerId !== event.pointerId) return
    drag.next = clampCrop({
      x: drag.overflowX > 0 ? drag.start.x - (event.clientX - drag.x) / drag.overflowX : drag.start.x,
      y: drag.overflowY > 0 ? drag.start.y - (event.clientY - drag.y) / drag.overflowY : drag.start.y,
      zoom: drag.start.zoom,
    })
    scheduleDraw()
  }

  const finishCropDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = cropDrag.current
    if (drag?.pointerId !== event.pointerId) return
    cropDrag.current = null
    delete document.documentElement.dataset.lustraPreviewDrag
    event.currentTarget.classList.remove('is-dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (commit && (drag.next.x !== drag.start.x || drag.next.y !== drag.start.y)) onCropChange?.(drag.next)
    scheduleDraw()
  }

  const moveCropByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const direction = directions[event.key]
    if (!direction || !photoLayout) return
    const [dx, dy] = direction
    const step = event.shiftKey ? 0.2 : 0.05
    const x = photoLayout.overflowX > 0 ? crop.x + dx * step : crop.x
    const y = photoLayout.overflowY > 0 ? crop.y + dy * step : crop.y
    event.preventDefault()
    event.stopPropagation()
    onCropChange?.(clampCrop({ ...crop, x, y }))
  }

  const visible = photoLayout?.visible
  const interactive = !compact && !readOnly
  const canCrop = visible && interactive && !sourceMissing && frame.fit === 'fill' && onCropChange
  const missing = sourceMissing || status?.error

  return (
    <div className={`framed-preview-viewport${compact ? ' framed-preview-viewport--compact' : ''}`} ref={viewport}>
      <div className={`preview-board preview-board--${frame.style}`} style={size}>
        <div className="framed-preview-surface" ref={surface} hidden={!raster || !seen || sourceMissing} role="img" aria-label={compact ? undefined : photo.name} aria-hidden={compact || undefined} />
        {missing ? <span className="framed-preview-message"><ImageOff size={18} />{t('framePreview.unavailable')}</span> : !raster && !compact && <span className="framed-preview-message" role="status">{t('framePreview.loading')}</span>}
        {canCrop && <div className="framed-preview-crop" tabIndex={0} role="group" aria-label={t('framePreview.dragCrop')} title={t('framePreview.dragCrop')}
          style={toStyle(visible)} onPointerDown={startCropDrag} onPointerMove={moveCropDrag} onPointerUp={(event) => finishCropDrag(event, true)}
          onPointerCancel={(event) => finishCropDrag(event, false)} onLostPointerCapture={(event) => finishCropDrag(event, false)} onKeyDown={moveCropByKey} />}
        {raster && !sourceMissing && seen && <TextOverlay photo={photo} frame={frame} interactive={interactive} imageBounds={visible} canvasSize={size} onRevealInspector={onRevealInspector} />}
      </div>
    </div>
  )
}

function toStyle(rect: FrameRect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}
