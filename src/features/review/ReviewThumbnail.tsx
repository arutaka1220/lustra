import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { canvasAspectRatio, fitCanvasToBounds } from '../editor/frame-layout'
import { createCanvasRenderer, createFrameScene } from '../editor/frame-paint'
import { TextOverlay } from '../text/TextOverlay'
import { usePhotoThumbnail } from '../import/photo-thumbnail-cache'
import '../editor/frame-i18n'
import './review-thumbnail.css'

const OUTPUT_EDGE = 256
const RENDER_CACHE_LIMIT_BYTES = 24 * 1024 * 1024
type RenderedThumbnail = { key: string; canvas: HTMLCanvasElement; bytes: number; size: { width: number; height: number } }
const renderedCache = new Map<string, RenderedThumbnail>()
let renderedCacheBytes = 0

function touchRendered(key: string, entry: RenderedThumbnail) {
  renderedCache.delete(key)
  renderedCache.set(key, entry)
}

function rememberRendered(entry: RenderedThumbnail) {
  renderedCache.set(entry.key, entry)
  renderedCacheBytes += entry.bytes
  while (renderedCacheBytes > RENDER_CACHE_LIMIT_BYTES && renderedCache.size > 1) {
    const oldest = renderedCache.entries().next().value as [string, RenderedThumbnail] | undefined
    if (!oldest) break
    renderedCache.delete(oldest[0])
    renderedCacheBytes -= oldest[1].bytes
  }
}

type Props = { photo: SessionPhoto; frame: FrameSettings; onAspectRatio?: (ratio: number) => void }

export function ReviewThumbnail({ photo, frame, onAspectRatio }: Props) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const displayCanvas = useRef<HTMLCanvasElement>(null)
  const [visibility, setVisibility] = useState({ visible: false, priority: 0 })
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const [rendered, setRendered] = useState<RenderedThumbnail>()
  const sourceUrl = photo.source.url
  const thumbnail = usePhotoThumbnail(visibility.visible ? sourceUrl : undefined, visibility.priority)
  const renderKey = useMemo(() => `${photo.id}:${sourceUrl}:${JSON.stringify({ ...frame, textElements: undefined })}`, [frame, photo.id, sourceUrl])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisibility({ visible: Boolean(entry?.isIntersecting), priority: entry?.intersectionRatio ?? 0 }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setAvailable({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const raster = thumbnail?.raster
    if (!visibility.visible || !raster || thumbnail?.url !== sourceUrl) return
    const cached = renderedCache.get(renderKey)
    if (cached) {
      touchRendered(renderKey, cached)
      setRendered(cached)
      return
    }

    const size = fitCanvasToBounds({ width: OUTPUT_EDGE, height: OUTPUT_EDGE }, canvasAspectRatio(frame, raster))
    const renderer = createCanvasRenderer()
    renderer.render(createFrameScene(size, raster, frame))
    const canvas = renderer.canvas
    const entry = { key: renderKey, canvas, size, bytes: canvas.width * canvas.height * 4 }
    rememberRendered(entry)
    setRendered(entry)
  }, [frame, renderKey, sourceUrl, thumbnail, visibility.visible])

  const currentRendered = rendered?.key === renderKey ? rendered : undefined
  const ratio = canvasAspectRatio(frame, thumbnail?.raster)
  useEffect(() => {
    if (thumbnail?.raster) onAspectRatio?.(ratio)
  }, [onAspectRatio, ratio, thumbnail?.raster])
  const board = fitCanvasToBounds({
    width: Math.max(1, available.width - 2),
    height: Math.max(1, available.height - 2),
  }, ratio)

  useEffect(() => {
    const destination = displayCanvas.current
    const source = currentRendered?.canvas
    if (!destination || !source) return
    if (destination.width !== source.width) destination.width = source.width
    if (destination.height !== source.height) destination.height = source.height
    destination.getContext('2d')?.drawImage(source, 0, 0)
  }, [currentRendered])

  return <div className="review-thumbnail" ref={viewport}>
    {currentRendered && thumbnail?.raster ? <div className={`preview-board preview-board--${frame.style} review-thumbnail__board`} style={{ ...board, '--custom-frame-color': frame.customColor ?? '#000000' } as React.CSSProperties}>
      <canvas className="review-thumbnail__canvas" ref={displayCanvas} aria-hidden="true" />
      <TextOverlay photo={photo} frame={frame} canvasSize={board} />
    </div> : thumbnail?.error
      ? <span className="review-thumbnail__message" role="status">{t('framePreview.unavailable')}</span>
      : <span className="review-thumbnail__placeholder" role="status">{t('framePreview.loading')}</span>}
  </div>
}
