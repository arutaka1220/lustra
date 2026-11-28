import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePhotoThumbnail } from './photo-thumbnail-cache'
import './photo-thumbnail.css'

type Props = { url?: string; fit?: 'cover' | 'contain' }

export function PhotoThumbnailCanvas({ url, fit = 'cover' }: Props) {
  const { t } = useTranslation()
  const root = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const [visibility, setVisibility] = useState({ visible: false, priority: 0 })
  const state = usePhotoThumbnail(visibility.visible ? url : undefined, visibility.priority)

  useEffect(() => setFallbackFailed(false), [url])

  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisibility({ visible: true, priority: 1 })
      return
    }
    setVisibility({ visible: false, priority: 0 })
    const observer = new IntersectionObserver(([entry]) => setVisibility({ visible: Boolean(entry?.isIntersecting), priority: entry?.intersectionRatio ?? 0 }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [url])

  useEffect(() => {
    const element = canvas.current
    const raster = state?.raster
    if (!element) return
    if (!visibility.visible || !raster) {
      element.width = 0
      element.height = 0
      return
    }

    const draw = () => {
      const bounds = element.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * dpr))
      const height = Math.max(1, Math.round(bounds.height * dpr))
      if (element.width !== width) element.width = width
      if (element.height !== height) element.height = height
      const context = element.getContext('2d')
      if (!context) return
      const scale = fit === 'cover'
        ? Math.max(width / raster.width, height / raster.height)
        : Math.min(width / raster.width, height / raster.height)
      const drawWidth = raster.width * scale
      const drawHeight = raster.height * scale
      context.clearRect(0, 0, width, height)
      context.drawImage(raster.image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit, state?.raster, visibility.visible])

  return <span className="photo-thumbnail" ref={root}>
    {state?.error && url
      ? fallbackFailed
        ? <span className="photo-thumbnail-error" role="img" aria-label={t('framePreview.unavailable')}><ImageOff size={18} /></span>
        : <img className="photo-thumbnail-fallback" src={url} alt="" loading="lazy" draggable={false} onError={() => setFallbackFailed(true)} />
      : <canvas className="photo-thumbnail-canvas" ref={canvas} aria-hidden="true" />}
  </span>
}
