import * as Dialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, ChevronRight, Ellipsis, ImageOff, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../../store/session-store'
import { PhotoThumbnailCanvas } from '../import/PhotoThumbnailCanvas'
import type { SessionPhoto } from '../../types/photo'

const filmstripDragType = 'application/x-lustra-photo'

type Props = {
  photos: SessionPhoto[]
  activePhotoId: string
  completed: number
  expanded: boolean
  onToggle: () => void
  onAddPhotos: () => void
}

export function Filmstrip({ photos, activePhotoId, completed, expanded, onToggle, onAddPhotos }: Props) {
  const { t } = useTranslation()
  const activate = useSessionStore((state) => state.setActivePhoto)
  const reorder = useSessionStore((state) => state.reorderPhotos)
  const remove = useSessionStore((state) => state.removePhoto)
  const restore = useSessionStore((state) => state.restorePhoto)
  const removed = useSessionStore((state) => state.removedPhotos)
  const [optionsId, setOptionsId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const optionsPhoto = photos.find((photo) => photo.id === optionsId)

  function openOptions(id: string) {
    setConfirmRemove(false)
    setOptionsId(id)
  }

  function moveBy(id: string, amount: number) {
    const index = photos.findIndex((photo) => photo.id === id)
    const next = photos[index + amount]
    if (next) reorder(id, next.id)
  }

  function removeSelected() {
    if (!optionsPhoto) return
    remove(optionsPhoto.id)
    setOptionsId(null)
  }

  function requestRemove() {
    if (!optionsPhoto) return
    const { overrides, completed: isComplete, crop, metadataOverrides } = optionsPhoto
    if (isComplete || crop || Object.keys(overrides).length || Object.keys(metadataOverrides ?? {}).length) setConfirmRemove(true)
    else removeSelected()
  }

  return <>
    <section className={`filmstrip${expanded ? '' : ' is-collapsed'}`} aria-label={t('edit.photos')}>
      <div className="filmstrip-heading">
        <div className="filmstrip-heading__main">
          <button className="filmstrip-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls={expanded ? 'filmstrip-track' : undefined} aria-label={t(expanded ? 'edit.hideFilmstrip' : 'edit.showFilmstrip')} title={t(expanded ? 'edit.hideFilmstrip' : 'edit.showFilmstrip')}>
            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </button>
          <div className="filmstrip-heading__summary">
            <strong>{t('edit.photos')}</strong>
            <span>{t('session.photoCount', { count: photos.length })}</span>
            <span className="filmstrip-completion">{t('edit.completion', { count: completed, total: photos.length })}</span>
          </div>
        </div>
        <div className="filmstrip-actions">
          {removed.length > 0 && <details className="recently-removed">
            <summary>{t('session.removed')} ({removed.length})</summary>
            <ul>{removed.map(({ photo }) => <li key={photo.id}><span title={photo.name}>{photo.name}</span><button className="button button--secondary button--small" onClick={() => restore(photo.id)}>{t('session.restore')}</button></li>)}</ul>
          </details>}
          <button className="filmstrip-add" onClick={onAddPhotos}><Plus size={15} /> {t('import.addFiles')}</button>
        </div>
      </div>
      {expanded && <div className="filmstrip-track" id="filmstrip-track">
        {photos.map((photo, index) => <div className="filmstrip-tile" key={photo.id}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(filmstripDragType)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(event) => {
            const from = event.dataTransfer.getData(filmstripDragType)
            if (!from) return
            event.preventDefault()
            event.stopPropagation()
            reorder(from, photo.id)
          }}
          onContextMenu={(event) => { event.preventDefault(); openOptions(photo.id) }}>
          <button className={`filmstrip-item ${photo.id === activePhotoId ? 'is-active' : ''} ${photo.completed ? 'is-complete' : ''}`}
            onClick={() => activate(photo.id)} draggable aria-current={photo.id === activePhotoId ? 'true' : undefined}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(filmstripDragType, photo.id)
            }}
            onKeyDown={(event) => {
              if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                event.preventDefault()
                event.stopPropagation()
                moveBy(photo.id, event.key === 'ArrowRight' ? 1 : -1)
              }
            }}>
            <span className="filmstrip-thumb">
              {photo.source.url ? <PhotoThumbnailCanvas url={photo.source.url} fit="contain" /> : <ImageOff size={17} aria-label={t('session.sourceMissing')} />}
              {photo.completed && <span className="filmstrip-check"><Check size={12} /></span>}
            </span>
            <span className="filmstrip-name"><span>{String(index + 1).padStart(2, '0')}</span><span title={photo.name}>{photo.name}</span></span>
          </button>
          <button className="filmstrip-options" onClick={() => openOptions(photo.id)} aria-label={t('session.photoOptions', { name: photo.name })}><Ellipsis size={14} /></button>
        </div>)}
      </div>}
    </section>
    <Dialog.Root open={Boolean(optionsPhoto)} onOpenChange={(open) => { if (!open) setOptionsId(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <Dialog.Title className="dialog-title">{confirmRemove ? t('session.remove') : optionsPhoto?.name}</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {confirmRemove ? t('session.removeBody', { name: optionsPhoto?.name }) : t('session.photoOptions', { name: optionsPhoto?.name })}
          </Dialog.Description>
          {!confirmRemove && optionsPhoto && <div className="photo-option-actions">
            <button className="button button--secondary" onClick={() => moveBy(optionsPhoto.id, -1)} disabled={photos[0]?.id === optionsPhoto.id}>{t('session.moveEarlier')}</button>
            <button className="button button--secondary" onClick={() => moveBy(optionsPhoto.id, 1)} disabled={photos.at(-1)?.id === optionsPhoto.id}>{t('session.moveLater')}</button>
          </div>}
          <div className="dialog-actions">
            <Dialog.Close asChild><button className="button button--quiet">{t(confirmRemove ? 'common.cancel' : 'common.close')}</button></Dialog.Close>
            <button className="button button--secondary" onClick={confirmRemove ? removeSelected : requestRemove}>{t('session.remove')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
