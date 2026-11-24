import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, FileSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessionStore, getEffectiveFrame, initialFrame, initialPortraitCardSettings } from '../../store/session-store'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { pickImageFiles, pickImageFolder } from '../import/photo-picker'
import { TextInspector } from '../text/TextInspector'
import { Filmstrip } from './Filmstrip'
import { FramePreview } from './FramePreview'
import { FrameControls } from './FrameControls'
import { CropControls } from './CropControls'
import { prefetchEditPreview, previewNeighborIndices } from './preview-cache'
import { useFilmstripLayout } from '../../hooks/useFilmstripLayout'
import { effectiveFrameSettings } from './frame-layout'
import { resetCropTransform } from './crop-model'

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
  const setCompleted = useSessionStore((state) => state.setCompleted)
  const setPhotoCrop = useSessionStore((state) => state.setPhotoCrop)
  const setPhotoCrops = useSessionStore((state) => state.setPhotoCrops)
  const doneNext = useSessionStore((state) => state.doneNext)
  const nextPhoto = useSessionStore((state) => state.nextPhoto)
  const previousPhoto = useSessionStore((state) => state.previousPhoto)
  const filmstripOpen = useSessionStore((state) => state.filmstripOpen)
  const toggleFilmstrip = useSessionStore((state) => state.toggleFilmstrip)
  const filmstripLayout = useFilmstripLayout()
  const resetOverride = useSessionStore((state) => state.resetPhotoOverride)
  const resetOverrideGroup = useSessionStore((state) => state.resetPhotoOverrideGroup)
  const resetAllOverrides = useSessionStore((state) => state.resetPhotoOverrides)
  const markMissing = useSessionStore((state) => state.markPhotoSourceMissing)
  const relink = useSessionStore((state) => state.relinkPhoto)
  const [relinkError, setRelinkError] = useState<{ id: string; key: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const initialCrops = useRef<Record<string, SessionPhoto['cropTransform']>>({})
  const frame = useMemo(() => getEffectiveFrame(activePhoto, commonFrame), [activePhoto, commonFrame])
  const rawControlsFrame = editMode === 'all' ? getEffectiveFrame(activePhoto, commonFrame) : frame
  const controlsFrame = effectiveFrameSettings(rawControlsFrame)
  const updateCanvasFrame = <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => {
    if (rawControlsFrame.canvasLayout === 'portraitCard') {
      if (key === 'style') { updateFrame('portraitBackgroundStyle', value as FrameSettings['style']); return }
      if (key === 'customColor') { updateFrame('portraitBackgroundCustomColor', value as string); return }
      if (key === 'blurStrength') { updateFrame('portraitBackgroundBlur', value as number); return }
      if (key === 'backgroundBrightness') { updateFrame('portraitBackgroundBrightness', value as number); return }
    }
    updateFrame(key, value)
  }
  const patchCanvasFrame = (changes: Partial<FrameSettings>) => {
    const mapped: Partial<FrameSettings> = { ...changes }
    if (rawControlsFrame.canvasLayout === 'portraitCard') {
      if ('style' in mapped) { mapped.portraitBackgroundStyle = mapped.style; delete mapped.style }
      if ('customColor' in mapped) { mapped.portraitBackgroundCustomColor = mapped.customColor; delete mapped.customColor }
      if ('blurStrength' in mapped) { mapped.portraitBackgroundBlur = mapped.blurStrength; delete mapped.blurStrength }
      if ('backgroundBrightness' in mapped) { mapped.portraitBackgroundBrightness = mapped.backgroundBrightness; delete mapped.backgroundBrightness }
    }
    patchFrame(mapped)
  }
  const resetCategory = (category: 'canvas' | 'frame' | 'padding' | 'effects') => {
    const standardStyleKeys: (keyof FrameSettings)[] = ['blurStrength', 'backgroundBrightness', 'backgroundOpacity', 'ambientIntensity', 'ambientSoftness', 'ambientBrightness', 'ambientColorSource', 'edgeStretchMode', 'edgeStretchBlur', 'edgeStretchFade', 'showInset', 'showShadow']
    const portraitKeys: (keyof FrameSettings)[] = ['portraitPhotoSize', 'portraitVerticalPosition', 'portraitBackgroundStyle', 'portraitBackgroundCustomColor', 'portraitBackgroundBlur', 'portraitBackgroundBrightness']
    const styleAppearanceKeys: (keyof FrameSettings)[] = rawControlsFrame.style === 'blurred' ? standardStyleKeys.slice(0, 3)
      : rawControlsFrame.style === 'ambientGradient' ? standardStyleKeys.slice(3, 7)
        : rawControlsFrame.style === 'edgeStretch' ? standardStyleKeys.slice(7, 10) : []
    const keys: (keyof FrameSettings)[] = category === 'canvas' ? ['canvasLayout', 'portraitRatio']
      : category === 'frame' ? rawControlsFrame.canvasLayout === 'portraitCard' ? ['portraitBackgroundStyle', 'portraitBackgroundCustomColor', 'autoTextColor', 'manualTextColor'] : ['style', 'customColor', 'autoTextColor', 'manualTextColor']
        : category === 'padding' ? ['top', 'bottom', 'left', 'right', 'linkSides', 'linkVertical', 'linkedPaddingRestore']
          : rawControlsFrame.canvasLayout === 'portraitCard' ? portraitKeys
            : [...styleAppearanceKeys, 'showInset', 'showShadow']
    if (editMode === 'this') {
      resetOverrideGroup(photo.id, keys)
      return
    }
    const defaults: Partial<FrameSettings> = category === 'canvas' ? { canvasLayout: 'standard', portraitRatio: undefined }
      : category === 'frame' ? rawControlsFrame.canvasLayout === 'portraitCard' ? { portraitBackgroundStyle: initialPortraitCardSettings.portraitBackgroundStyle, portraitBackgroundCustomColor: initialPortraitCardSettings.portraitBackgroundCustomColor, autoTextColor: true } : { style: initialFrame.style, customColor: undefined, autoTextColor: true }
        : category === 'padding' ? { top: initialFrame.top, bottom: initialFrame.bottom, left: initialFrame.left, right: initialFrame.right, linkSides: initialFrame.linkSides, linkVertical: initialFrame.linkVertical, linkedPaddingRestore: undefined, aspectPadding: undefined }
          : rawControlsFrame.canvasLayout === 'portraitCard' ? {
            portraitPhotoSize: initialPortraitCardSettings.portraitPhotoSize,
            portraitVerticalPosition: initialPortraitCardSettings.portraitVerticalPosition,
            portraitBackgroundStyle: initialPortraitCardSettings.portraitBackgroundStyle,
            portraitBackgroundCustomColor: initialPortraitCardSettings.portraitBackgroundCustomColor,
            portraitBackgroundBlur: initialPortraitCardSettings.portraitBackgroundBlur,
            portraitBackgroundBrightness: initialPortraitCardSettings.portraitBackgroundBrightness,
          }
            : { blurStrength: initialFrame.blurStrength, backgroundBrightness: initialFrame.backgroundBrightness, backgroundOpacity: initialFrame.backgroundOpacity, ambientIntensity: initialFrame.ambientIntensity, ambientSoftness: initialFrame.ambientSoftness, ambientBrightness: initialFrame.ambientBrightness, ambientColorSource: initialFrame.ambientColorSource, edgeStretchMode: initialFrame.edgeStretchMode, edgeStretchBlur: initialFrame.edgeStretchBlur, edgeStretchFade: initialFrame.edgeStretchFade, showInset: initialFrame.showInset, showShadow: initialFrame.showShadow }
    const targetedDefaults = category === 'effects'
      ? Object.fromEntries(keys.filter((key) => Object.hasOwn(defaults, key)).map((key) => [key, defaults[key]])) as Partial<FrameSettings>
      : defaults
    patchCanvasFrame(targetedDefaults)
  }
  const resetSetting = (key: keyof FrameSettings, value: FrameSettings[keyof FrameSettings]) => {
    if (editMode === 'this') resetOverride(photo.id, key)
    else patchCanvasFrame({ [key]: value } as Partial<FrameSettings>)
  }
  const resetTextColor = () => {
    if (editMode === 'this') resetOverrideGroup(photo.id, ['autoTextColor', 'manualTextColor'])
    else patchCanvasFrame({ autoTextColor: true })
  }
  const captureCropStart = () => {
    initialCrops.current = editMode === 'all'
      ? Object.fromEntries(photos.map(({ id, cropTransform }) => [id, cropTransform]))
      : { [photo.id]: photo.cropTransform }
  }
  const cancelCrop = () => {
    setPhotoCrops(initialCrops.current)
    endFrameEdit()
    setCropMode(false)
  }
  const resetCrops = (action: 'crop' | 'ratio' | 'lock' | 'rotation') => {
    const targets = editMode === 'all' ? photos : activePhoto ? [activePhoto] : []
    setPhotoCrops(Object.fromEntries(targets.map((target) => [target.id,
      resetCropTransform(target.cropTransform, action, target.imageWidth ?? 0, target.imageHeight ?? 0),
    ])))
  }
  const index = Math.max(0, photos.findIndex((photo) => photo.id === activePhoto?.id))
  const prefetchKey = previewNeighborIndices(photos.length, index).map(i => `${photos[i].id}\t${photos[i].source.url}`).join('\n')
  useEffect(() => {
    if (!prefetchKey) return
    const controller = new AbortController()
    for (const entry of prefetchKey.split('\n')) {
      const [id, url] = entry.split('\t')
      if (id && url) void prefetchEditPreview(url, controller.signal, id === activePhoto?.id ? 90 : 10).catch(() => {})
    }
    return () => controller.abort()
  }, [activePhoto?.id, prefetchKey])
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
          <div className="editor-normal-controls" hidden={cropMode}>
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
          <FrameControls frame={controlsFrame} onChange={updateCanvasFrame}
            onPatch={patchCanvasFrame} onFrameEditStart={beginFrameEdit} onFrameEditEnd={endFrameEdit} onResetCategory={resetCategory} onResetSetting={resetSetting} onResetTextColor={resetTextColor}
          >
            <TextInspector photo={photo} frame={controlsFrame} />
          </FrameControls>
          </div>
          {cropMode && <CropControls crop={photo.cropTransform} sourceWidth={photo.imageWidth ?? 1} sourceHeight={photo.imageHeight ?? 1}
            onChange={crop => setPhotoCrop(photo.id, { ...crop, rotation: crop.rotation ?? photo.cropTransform?.rotation ?? 0 })}
            onResetCrop={() => resetCrops('crop')}
            onResetRatio={() => resetCrops('ratio')}
            onResetLock={() => resetCrops('lock')}
            onResetRotation={() => resetCrops('rotation')}
            onApply={() => { endFrameEdit(); setCropMode(false) }} onCancel={cancelCrop} />}
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

      <section className="preview-area">
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
              ? <FramePreview photo={photo} frame={frame} crop={photo.cropTransform} cropMode={cropMode} onCropModeChange={active => { if (active) captureCropStart(); setCropMode(active) }} onCropChange={crop => setPhotoCrop(photo.id, crop)} onCropCancel={cancelCrop} onCropEditStart={beginFrameEdit} onCropEditEnd={endFrameEdit} onPortraitPositionChange={position => updateFrame('portraitVerticalPosition', position)} onPortraitPositionEditStart={beginFrameEdit} onPortraitPositionEditEnd={endFrameEdit} onImageError={() => markMissing(photo.id, photo.source)} onRevealInspector={onRevealInspector} />
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

        <Filmstrip photos={photos} activePhotoId={photo.id} completed={completed} expanded={filmstripOpen} height={filmstripLayout.height} onResize={filmstripLayout.startResize} onResetHeight={filmstripLayout.reset} onResizeBy={filmstripLayout.resizeBy} onToggle={toggleFilmstrip} onAddPhotos={onAddPhotos} />
      </section>
    </main>
  )
}
