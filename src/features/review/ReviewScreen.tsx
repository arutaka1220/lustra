import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, Download, ImageOff, ImagePlus, Minus, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { getEffectiveFrame, useSessionStore } from '../../store/session-store'
import { FramePreview } from '../editor/FramePreview'
import { ReviewThumbnail } from './ReviewThumbnail'
import { buildReviewLayout } from './review-layout'
import { useReviewMinimumSize } from './useReviewMinimumSize'

type ReviewCardProps = {
  photo: SessionPhoto
  commonFrame: FrameSettings
  index: number
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onAspectRatio: (ratio: number) => void
  width: number
  height: number
  position: { left: number; top: number }
}

const ReviewCard = memo(function ReviewCard({ photo, commonFrame, index, onOpen, onEdit, onAspectRatio, width, height, position }: ReviewCardProps) {
  const { t } = useTranslation()
  const frame = useMemo(() => getEffectiveFrame(photo, commonFrame), [commonFrame, photo])

  return <article className="review-card" style={{ width, height, left: position.left, top: position.top }}>
    <button className="review-card__image" onClick={() => photo.source.url ? onOpen(photo.id) : onEdit(photo.id)} aria-label={t('review.openPhoto', { name: photo.name })}>
      {photo.source.url ? <ReviewThumbnail photo={photo} frame={frame} onAspectRatio={onAspectRatio} />
        : <span className="review-missing"><ImageOff size={22} /> {t('session.sourceMissing')}</span>}
      {photo.completed && <span className="review-complete-mark" aria-label={t('edit.completed')}><Check size={14} /></span>}
    </button>
    <div className="review-card__info">
      <span className="review-card__number">{String(index + 1).padStart(2, '0')}</span>
      <div><strong title={photo.name}>{photo.name}</strong></div>
      <button className="icon-button review-edit-button" onClick={() => onEdit(photo.id)} aria-label={t('review.editPhoto', { name: photo.name })}><Pencil size={14} /></button>
    </div>
  </article>
})

export function ReviewScreen() {
  const { t } = useTranslation()
  const photos = useSessionStore((state) => state.photos)
  const commonFrame = useSessionStore((state) => state.commonFrame)
  const setActivePhoto = useSessionStore((state) => state.setActivePhoto)
  const setScreen = useSessionStore((state) => state.setScreen)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const gallery = useRef<HTMLDivElement>(null)
  const [galleryWidth, setGalleryWidth] = useState(0)
  const [galleryHeight, setGalleryHeight] = useState(0)
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const minimumSizePreference = useReviewMinimumSize()
  const selected = photos.find((photo) => photo.id === selectedId)
  const completed = photos.filter((photo) => photo.completed).length
  useEffect(() => {
    const element = gallery.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const height = entry?.contentRect.height ?? 0
      setGalleryWidth((current) => Math.abs(current - width) < 1 ? current : width)
      setGalleryHeight((current) => Math.abs(current - height) < 1 ? current : height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [photos.length])

  const setPhotoAspect = useCallback((id: string, aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    setAspects((current) => Math.abs((current[id] ?? 0) - aspect) < 0.001 ? current : { ...current, [id]: aspect })
  }, [])

  const aspectCallbacks = useMemo(() => new Map(photos.map((photo) => [photo.id, (ratio: number) => setPhotoAspect(photo.id, ratio)])), [photos, setPhotoAspect])

  const layout = useMemo(() => buildReviewLayout(photos.map((photo) => aspects[photo.id] ?? 1.5), galleryWidth, galleryHeight, 10, minimumSizePreference.minimumSize), [aspects, galleryHeight, galleryWidth, minimumSizePreference.minimumSize, photos])

  const editPhoto = useCallback((id: string) => {
    setActivePhoto(id)
    setScreen('edit')
  }, [setActivePhoto, setScreen])
  const openPhoto = useCallback((id: string) => setSelectedId(id), [])

  return (
    <main className="review-view">
      <div className="review-heading">
        <div>
          <h1>{t('review.title')}</h1>
          <p>{t('review.body')}</p>
        </div>
        <div className="review-heading__actions">
          <span className="review-completion"><Check size={14} /> {t('edit.completion', { count: completed, total: String(photos.length) })}</span>
          <div className="review-size-control">
            <label htmlFor="review-minimum-size">{t('review.minimumSize')}</label>
            <div className="review-size-control__slider">
              <Minus size={14} aria-hidden="true" />
              <input id="review-minimum-size" type="range" min={160} max={400} step={20} value={minimumSizePreference.minimumSize}
                disabled={!minimumSizePreference.ready || layout.mode !== 'justified'} aria-valuetext={`${minimumSizePreference.minimumSize}px`}
                onChange={(event) => minimumSizePreference.update(Number(event.currentTarget.value))} />
              <Plus size={14} aria-hidden="true" />
              <output htmlFor="review-minimum-size">{minimumSizePreference.minimumSize}px</output>
              <button type="button" className="icon-button review-size-control__reset" aria-label={t('review.resetMinimumSize')}
                title={t('review.resetMinimumSize')} disabled={!minimumSizePreference.ready || minimumSizePreference.minimumSize === 240}
                onClick={minimumSizePreference.reset}><RotateCcw size={13} /></button>
            </div>
          </div>
          <button className="button button--quiet" onClick={() => setScreen('edit')}><ArrowLeft size={15} /> {t('review.back')}</button>
          <button className="button button--primary" disabled={!photos.length} onClick={() => setScreen('export')}><Download size={15} /> {t('review.export')}</button>
        </div>
      </div>
      {photos.length === 0 ? (
        <div className="review-empty"><ImagePlus size={25} /><strong>{t('review.empty')}</strong></div>
      ) : (
        <div className="review-grid" ref={gallery}>
          <div className="review-grid__canvas" style={{ height: layout.height }}>
            {layout.tiles.map((tile) => {
              const photo = photos[tile.index]
              return <ReviewCard key={photo.id} photo={photo} commonFrame={commonFrame} index={tile.index} onOpen={openPhoto} onEdit={editPhoto}
                onAspectRatio={aspectCallbacks.get(photo.id)!} width={tile.width} height={tile.height}
                position={{ left: tile.x, top: tile.y }} />
            })}
          </div>
        </div>
      )}
      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="settings-dialog review-preview-dialog">
            <div className="review-preview-heading">
              <Dialog.Title className="dialog-title">{selected?.name}</Dialog.Title>
              <Dialog.Close asChild><button className="icon-button" aria-label={t('common.close')}><X size={16} /></button></Dialog.Close>
            </div>
            <Dialog.Description className="visually-hidden">{t('review.title')}</Dialog.Description>
            {selected && <div className="review-preview-stage">
              <FramePreview photo={selected} frame={getEffectiveFrame(selected, commonFrame)} readOnly
                fallbackPreview={<div className="review-preview-fallback"><ReviewThumbnail photo={selected} frame={getEffectiveFrame(selected, commonFrame)} /></div>} />
            </div>}
            {selected && <div className="dialog-actions"><button className="button button--primary" onClick={() => editPhoto(selected.id)}><Pencil size={15} /> {t('review.back')}</button></div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  )
}
