import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, Circle, Download, ImageOff, ImagePlus, Pencil, X } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { getEffectiveFrame, useSessionStore } from '../../store/session-store'
import { FramePreview } from '../editor/FramePreview'
import { PhotoGrid } from '../import/PhotoGrid'
import { ReviewThumbnail } from './ReviewThumbnail'

type ReviewCardProps = {
  photo: SessionPhoto
  commonFrame: FrameSettings
  index: number
  onOpen: (id: string) => void
  onEdit: (id: string) => void
}

const ReviewCard = memo(function ReviewCard({ photo, commonFrame, index, onOpen, onEdit }: ReviewCardProps) {
  const { t } = useTranslation()
  const frame = useMemo(() => getEffectiveFrame(photo, commonFrame), [commonFrame, photo])

  return <article className="review-card">
    <button className="review-card__image" onClick={() => photo.source.url ? onOpen(photo.id) : onEdit(photo.id)} aria-label={t('review.openPhoto', { name: photo.name })}>
      {photo.source.url ? <ReviewThumbnail photo={photo} frame={frame} />
        : <span className="review-missing"><ImageOff size={22} /> {t('session.sourceMissing')}</span>}
    </button>
    <div className="review-card__info">
      <span className="review-card__number">{String(index + 1).padStart(2, '0')}</span>
      <div><strong title={photo.name}>{photo.name}</strong></div>
      <span className={`review-status ${photo.completed ? 'is-complete' : ''}`}>{photo.completed
        ? <><Check size={11} /> {t('edit.completed')}</> : <><Circle size={10} /> {t('review.incomplete')}</>}</span>
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
  const selected = photos.find((photo) => photo.id === selectedId)
  const completed = photos.filter((photo) => photo.completed).length

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
          <span className="review-completion"><Check size={14} /> {t('edit.completion', { count: completed, total: photos.length })}</span>
          <button className="button button--quiet" onClick={() => setScreen('edit')}><ArrowLeft size={15} /> {t('review.back')}</button>
          <button className="button button--primary" disabled={!photos.length} onClick={() => setScreen('export')}><Download size={15} /> {t('review.export')}</button>
        </div>
      </div>
      {photos.length === 0 ? (
        <div className="review-empty"><ImagePlus size={25} /><strong>{t('review.empty')}</strong></div>
      ) : (
        <PhotoGrid
          className="review-grid"
          items={photos}
          minColumnWidth={220}
          gap={16}
          padding={0}
          itemHeight={() => 280}
          style={{ flex: 1, minHeight: 0 }}
          renderItem={(photo, index) => <ReviewCard key={photo.id} photo={photo} commonFrame={commonFrame} index={index} onOpen={openPhoto} onEdit={editPhoto} />}
        />
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
              <FramePreview photo={selected} frame={getEffectiveFrame(selected, commonFrame)} readOnly />
            </div>}
            {selected && <div className="dialog-actions"><button className="button button--primary" onClick={() => editPhoto(selected.id)}><Pencil size={15} /> {t('review.back')}</button></div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  )
}
