import { useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, FileSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessionStore, getEffectiveFrame } from '../../store/session-store'
import type { FrameSettings } from '../../types/photo'
import { pickImageFiles, pickImageFolder } from '../import/photo-picker'
import { TextInspector } from '../text/TextInspector'
import { Filmstrip } from './Filmstrip'
import { FramePreview } from './FramePreview'
import { FrameControls } from './FrameControls'
import { PresetControls } from './PresetControls'

type EditorScreenProps = {
  inspectorOpen: boolean
  inspectorWidth: number
  onResizeInspector: (event: PointerEvent<HTMLElement>) => void
  onResetInspectorWidth: () => void
  onResizeInspectorBy: (amount: number) => void
  onRevealInspector: () => void
  onAddPhotos: () => void
}

export function EditorScreen({ inspectorOpen, inspectorWidth, onResizeInspector, onResetInspectorWidth, onResizeInspectorBy, onRevealInspector, onAddPhotos }: EditorScreenProps) {
  const { t } = useTranslation()
  const photos = useSessionStore((state) => state.photos)
  const activePhotoId = useSessionStore((state) => state.activePhotoId)
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? photos[0]
  const commonFrame = useSessionStore((state) => state.commonFrame)
  const editMode = useSessionStore((state) => state.editMode)
  const setEditMode = useSessionStore((state) => state.setEditMode)
  const updateFrame = useSessionStore((state) => state.updateFrame)
  const patchFrame = useSessionStore((state) => state.patchFrame)
  const beginFrameEdit = useSessionStore((state) => state.beginFrameEdit)
  const endFrameEdit = useSessionStore((state) => state.endFrameEdit)
  const setRatio = useSessionStore((state) => state.setRatio)
  const setCrop = useSessionStore((state) => state.setCrop)
  const setCompleted = useSessionStore((state) => state.setCompleted)
  const doneNext = useSessionStore((state) => state.doneNext)
  const nextPhoto = useSessionStore((state) => state.nextPhoto)
  const previousPhoto = useSessionStore((state) => state.previousPhoto)
  const filmstripOpen = useSessionStore((state) => state.filmstripOpen)
  const toggleFilmstrip = useSessionStore((state) => state.toggleFilmstrip)
  const resetOverride = useSessionStore((state) => state.resetPhotoOverride)
  const resetAllOverrides = useSessionStore((state) => state.resetPhotoOverrides)
  const markMissing = useSessionStore((state) => state.markPhotoSourceMissing)
  const relink = useSessionStore((state) => state.relinkPhoto)
  const [relinkError, setRelinkError] = useState<{ id: string; key: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const frame = useMemo(() => getEffectiveFrame(activePhoto, commonFrame), [activePhoto, commonFrame])
  const controlsFrame = editMode === 'all' ? commonFrame : frame
  const index = Math.max(0, photos.findIndex((photo) => photo.id === activePhoto?.id))
  const completed = photos.filter((photo) => photo.completed).length
  const layoutStyle = { '--inspector-width': `${inspectorWidth}px` } as CSSProperties

  if (!activePhoto) return null
  const photo = activePhoto
  const overrides = Object.keys(photo.overrides) as (keyof FrameSettings)[]

  const handleInspectorResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      onResizeInspectorBy(direction * (event.shiftKey ? 20 : 8))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onResetInspectorWidth()
    }
  }

  async function locate(fromFolder: boolean) {
    setRelinkError(null)
    setLocating(true)
    try {
      const candidates = await (fromFolder ? pickImageFolder() : pickImageFiles({ multiple: false, title: t('session.locateFile') }))
      if (!candidates || (!fromFolder && !candidates.length)) return
      const oldName = photo.source.kind === 'path' ? photo.source.path.split(/[\\/]/).at(-1) ?? photo.name : photo.name
      const matches = fromFolder ? candidates.filter((candidate) => candidate.name.toLocaleLowerCase() === oldName.toLocaleLowerCase()) : candidates
      if (matches.length !== 1 || !relink(photo.id, matches[0].source)) {
        setRelinkError({ id: photo.id, key: matches.length === 1 ? 'session.relinkDuplicate' : 'session.relinkNoMatch' })
      }
    } catch {
      setRelinkError({ id: photo.id, key: 'session.relinkError' })
    } finally {
      setLocating(false)
    }
  }

  return (
    <main className={`editor-layout ${inspectorOpen ? '' : 'editor-layout--inspector-collapsed'}`} style={layoutStyle}>
      {inspectorOpen && <>
        <aside className="settings-panel" aria-label={t('edit.inspector')}>
          <div className="scope-control">
            <span className="scope-control__label">{t('edit.applyTo')}</span>
            <div className="scope-tabs" role="group" aria-label={t('edit.applyTo')}>
              <button className={editMode === 'all' ? 'is-active' : ''} onClick={() => setEditMode('all')} aria-pressed={editMode === 'all'}>{t('edit.allPhotos')}<span>{photos.length}</span></button>
              <button className={editMode === 'this' ? 'is-active' : ''} onClick={() => setEditMode('this')} aria-pressed={editMode === 'this'}>{t('edit.thisPhoto')}</button>
            </div>
            {overrides.length > 0 && <details className="override-settings">
              <summary>{t('edit.overrides', { count: overrides.length })}</summary>
              <ul>{overrides.map((key) => <li key={key}><span>{t(`edit.field.${key}`, { defaultValue: key })}</span><button className="text-button" onClick={() => resetOverride(photo.id, key)}>{t('edit.useCommon')}</button></li>)}</ul>
              <button className="text-button" onClick={() => resetAllOverrides(photo.id)}>{t('edit.resetOverrides')}</button>
            </details>}
          </div>
          <FrameControls frame={controlsFrame} onChange={updateFrame} onRatioChange={setRatio}
            crop={photo.crop} effectiveFit={frame.fit} onCropChange={(crop) => setCrop(photo.id, crop)}
            onPatch={patchFrame} onFrameEditStart={beginFrameEdit} onFrameEditEnd={endFrameEdit}
            preset={<PresetControls frame={controlsFrame} onApply={patchFrame} />}
          >
            <TextInspector photo={photo} frame={controlsFrame} />
          </FrameControls>
        </aside>
        <div
          className="inspector-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={450}
          aria-valuenow={inspectorWidth}
          aria-label={t('edit.resizeInspector')}
          tabIndex={0}
          title={t('edit.resizeInspector')}
          onKeyDown={handleInspectorResizeKeyDown}
          onPointerDown={onResizeInspector}
          onDoubleClick={onResetInspectorWidth}
        />
      </>}

      <section className="preview-area" data-frame-style={frame.style}>
        <div className="preview-toolbar">
          <div className="preview-breadcrumb">
            <strong title={photo.name}>{photo.name}</strong>
            {photo.metadataState === 'loading' && <span className="preview-metadata-loading" role="status">{t('import.reading')}</span>}
            <button className={`complete-state preview-completion ${photo.completed ? 'is-complete' : ''}`} aria-pressed={photo.completed} onClick={() => setCompleted(photo.id, !photo.completed)}>
              <span>{photo.completed && <Check size={12} />}</span>{photo.completed ? t('edit.completed') : t('review.incomplete')}
            </button>
          </div>
          <div className="preview-toolbar__actions">
            <div className="photo-navigation" role="group" aria-label={`${index + 1} / ${photos.length}`}>
              <button className="photo-nav-button" aria-label={t('edit.previous')} title={t('edit.previous')} onClick={previousPhoto} disabled={index === 0}><ArrowLeft size={16} /></button>
              <span className="photo-position" aria-live="polite">{index + 1} / {photos.length}</span>
              <button className="photo-nav-button" aria-label={t('edit.next')} title={t('edit.next')} onClick={nextPhoto} disabled={index === photos.length - 1}><ArrowRight size={16} /></button>
            </div>
            <button className="button button--primary button--compact" onClick={doneNext}><Check size={15} /> {t('edit.doneNext')}</button>
          </div>
        </div>

        <div className="preview-stage-wrap">
          <div className="preview-stage-content">
            {photo.source.url
              ? <FramePreview photo={photo} frame={frame} onCropChange={(crop) => setCrop(photo.id, crop)} onImageError={() => markMissing(photo.id, photo.source)} onRevealInspector={onRevealInspector} />
              : <div className="relink-card">
                <FileSearch size={26} />
                <strong>{t('session.sourceMissing')}</strong>
                <p>{t('session.locateBody', { name: photo.name })}</p>
                <div className="photo-option-actions">
                  <button className="button button--primary" onClick={() => void locate(false)} disabled={locating}>{t('session.locateFile')}</button>
                  <button className="button button--secondary" onClick={() => void locate(true)} disabled={locating}>{t('session.locateFolder')}</button>
                </div>
                {relinkError?.id === photo.id && <p className="workflow-error" role="alert">{t(relinkError.key)}</p>}
              </div>}
          </div>
        </div>

        <Filmstrip photos={photos} activePhotoId={photo.id} completed={completed} expanded={filmstripOpen} onToggle={toggleFilmstrip} onAddPhotos={onAddPhotos} />
      </section>
    </main>
  )
}
