import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { TextOverlay } from '../text/TextOverlay'
import { canvasAspectRatio, fitCanvasToBounds, getPhotoLayout } from './frame-layout'
import type { Size } from './frame-layout'
import { createCanvasRenderer, createFrameScene } from './frame-paint'
import type { PhotoRaster, PreviewRenderer } from './frame-paint'
import { useEditPreview } from './preview-cache'
import { usePhotoThumbnail } from '../import/photo-thumbnail-cache'
import { PhotoThumbnailCanvas } from '../import/PhotoThumbnailCanvas'
import './frame-i18n'
import '../../styles/frame-preview.css'
import { CropOverlay } from './CropOverlay'
import { applyCropToRaster } from './crop-model'

type FramePreviewProps = {
  photo: SessionPhoto
  frame: FrameSettings
  compact?: boolean
  readOnly?: boolean
  onImageError?: () => void
  onRevealInspector?: () => void
  fallbackPreview?: ReactNode
  crop?: SessionPhoto['cropTransform']
  cropMode?: boolean
  onCropModeChange?: (active: boolean) => void
  onCropChange?: (crop: SessionPhoto['cropTransform']) => void
  onCropEditStart?: () => void
  onCropEditEnd?: () => void
}

type LoadedPhoto = { url: string; raster?: PhotoRaster; error?: boolean }

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
  return { image: canvas, width: canvas.width, height: canvas.height }
}

export function FramePreview({ photo, frame, compact = false, readOnly = false, onImageError, onRevealInspector, fallbackPreview, crop, cropMode: controlledCropMode, onCropModeChange, onCropChange, onCropEditStart, onCropEditEnd }: FramePreviewProps) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const renderer = useRef<PreviewRenderer | null>(null)
  const fallback = useRef<(() => void) | null>(null)
  const animation = useRef(0)
  const [seen, setSeen] = useState(!compact)
  const [available, setAvailable] = useState<Size>({ width: 1, height: 1 })
  const [loaded, setLoaded] = useState<LoadedPhoto>()
  const [retryKey, setRetryKey] = useState(0)
  const [localCropMode, setLocalCropMode] = useState(false)
  const cropMode = controlledCropMode ?? localCropMode
  const changeCropMode = (active: boolean) => {
    if (controlledCropMode === undefined) setLocalCropMode(active)
    onCropModeChange?.(active)
  }
  const interactive = !compact && !readOnly
  const initialCrop = useRef(crop)
  useEffect(() => {
    if (!interactive) return
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (document.documentElement.dataset.lustraPreviewDrag || document.documentElement.dataset.lustraTextDrag) return
      if (target?.closest('input,textarea,select,[contenteditable="true"]') && !(cropMode && (event.key === 'Enter' || event.key === 'Escape'))) return
      if (event.key.toLowerCase() === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if (!cropMode) { initialCrop.current = crop; onCropEditStart?.() } else onCropEditEnd?.(); changeCropMode(!cropMode) }
      if (event.key === 'Enter' && cropMode) { event.preventDefault(); onCropEditEnd?.(); changeCropMode(false) }
      if (event.key === 'Escape' && cropMode) { event.preventDefault(); onCropChange?.(initialCrop.current); onCropEditEnd?.(); changeCropMode(false) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [interactive, cropMode, crop, onCropChange, onCropEditStart, onCropEditEnd, onCropModeChange, controlledCropMode])
  const sourceUrl = photo.source.url
  const status = loaded?.url === sourceUrl ? loaded : undefined
  const sourceMissing = photo.source.kind === 'path' && photo.source.missing === true
  const highResolution = useEditPreview(compact ? undefined : sourceUrl, seen && !sourceMissing, retryKey)
  const smallPreview = usePhotoThumbnail(!compact && sourceUrl && !sourceMissing ? sourceUrl : undefined, 100)
  const sourceRaster = compact ? status?.raster : highResolution?.raster
  const processedRaster = useMemo(() => {
    if (!sourceRaster || !crop || cropMode) return sourceRaster
    return applyCropToRaster(sourceRaster, crop)
  }, [sourceRaster, cropMode, crop?.x, crop?.y, crop?.width, crop?.height, crop?.rotation])
  const raster = cropMode ? sourceRaster : processedRaster
  const size = fitCanvasToBounds(available, canvasAspectRatio(frame, sourceRaster))
  const photoLayout = raster && getPhotoLayout(size, raster, frame)
  const paintRef = useRef<() => void>(() => {})
  const imageErrorRef = useRef(onImageError)

  const scheduleDraw = useCallback(() => {
    if (animation.current) return
    animation.current = window.requestAnimationFrame(() => {
      animation.current = 0
      paintRef.current()
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
    if (!compact || !seen || sourceMissing || !sourceUrl) return
    let active = true
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (active) setLoaded({ url: sourceUrl, raster: rasterizeImage(image, 480) })
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
    if (highResolution?.error) imageErrorRef.current?.()
  }, [highResolution?.error])

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
    paintRef.current = () => {
      if (!raster || !seen || sourceMissing || !renderer.current) return
      const scene = createFrameScene(size, raster, frame)
      try {
        renderer.current.render(scene)
      } catch {
        fallback.current?.()
      }
    }
    scheduleDraw()
  })

  const visible = photoLayout?.visible
  const missing = sourceMissing || status?.error || highResolution?.error

  return (
    <div className={`framed-preview-viewport${compact ? ' framed-preview-viewport--compact' : ''}`} ref={viewport}>
      <div className={`preview-board preview-board--${frame.style}${cropMode ? ' is-cropping' : ''}`} onDoubleClick={event => { const bounds = visible; const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top; const onPhoto = !!bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height; if (!interactive || !onPhoto || (event.target as HTMLElement).closest('.canvas-text, input, button, select')) return; if (document.documentElement.dataset.lustraPreviewDrag) return; initialCrop.current = crop; if (cropMode) onCropEditEnd?.(); else onCropEditStart?.(); changeCropMode(!cropMode) }} style={{ ...size, '--custom-frame-color': frame.customColor ?? '#000000' } as React.CSSProperties}>
        <div className="framed-preview-surface" ref={surface} hidden={!raster || !seen || sourceMissing} role="img" aria-label={compact ? undefined : photo.name} aria-hidden={compact || undefined} />
        {!raster && fallbackPreview}
        {!raster && !fallbackPreview && smallPreview?.raster && !missing && <div className="preview-loading-thumb" aria-hidden="true"><PhotoThumbnailCanvas url={sourceUrl} fit="contain" /></div>}
        {sourceMissing || status?.error ? <span className="framed-preview-message"><ImageOff size={18} />{t('framePreview.unavailable')}</span> : highResolution?.error ? <span className="framed-preview-message preview-error" role="alert">{t('framePreview.previewError')}<button type="button" onClick={() => { setLoaded(undefined); setRetryKey(value => value + 1) }}>{t('framePreview.retry')}</button></span> : !raster && !smallPreview?.raster && !fallbackPreview && !compact && <span className="framed-preview-message" role="status">{t('framePreview.loading')}</span>}
        {raster && !sourceMissing && seen && <TextOverlay photo={photo} frame={frame} interactive={interactive && !cropMode} imageBounds={visible} canvasSize={size} raster={raster} onRevealInspector={onRevealInspector} />}
        {cropMode && interactive && visible && sourceRaster && <CropOverlay bounds={visible} crop={crop} source={sourceRaster.image} sourceWidth={sourceRaster.width} sourceHeight={sourceRaster.height} onChange={value => onCropChange?.({ ...value, rotation: value.rotation ?? crop?.rotation ?? 0 })} />}
      </div>
    </div>
  )
}
