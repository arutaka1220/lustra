import { Eye, EyeOff, Group, Plus, RotateCcw, Trash2, Ungroup } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../../store/session-store'
import { ComboboxField } from '../../components/ui/ComboboxField'
import { SelectField } from '../../components/ui/SelectField'
import type { FrameSettings, PhotoMetadata, SessionPhoto } from '../../types/photo'
import { InspectorSection } from '../editor/InspectorSection'
import { SliderInput } from '../editor/SliderInput'
import { CustomColorPicker } from '../editor/CustomColorPicker'
import { useInspectorSections } from '../editor/useInspectorSections'
import { loadFontCatalog, SUGGESTED_FONTS } from './font-catalog'
import { useMetadataCorrections } from './metadata-corrections-store'
import { useSelectedTextIds, useTextEditor } from './text-editor-store'
import type { MetadataFocus } from './text-editor-store'
import {
  createTextElement, DEFAULT_TEXT_FONT, getEffectiveMetadata, getTextAnchorPosition, getTextElements, METADATA_VARIABLES,
  resolveTemplate, TEXT_ANCHORS, textColor,
} from './text-model'
import type { MetadataField, TextAnchor, TextElement } from './text-model'
import './text-i18n'
import './text.css'

const weights = [400, 500, 600, 700]

type TextInspectorProps = { photo: SessionPhoto; frame: FrameSettings }

function OffsetInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  return (
    <label>{label}
      <input
        className="text-field"
        type="number"
        step="0.1"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const number = Number(draft)
          const next = draft.trim() && Number.isFinite(number)
            ? Math.min(50000, Math.max(-50000, number))
            : value
          setDraft(String(next))
          if (next !== value) onChange(next)
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
    </label>
  )
}

function MetadataInput({ name, value, overridden, focus, onSave, onReset }: {
  name: MetadataField
  value: string
  overridden: boolean
  focus?: MetadataFocus
  onSave: (value: string | undefined) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (!focus || !input.current) return
    input.current.focus()
    if (document.activeElement === input.current) useTextEditor.getState().clearMetadataFocus(focus)
  }, [focus])

  const label = t(`text.metadata.${name}`)
  return (
    <div className="text-field-with-action">
      <label>{label}
        <input
          className="text-field"
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== value) onSave(draft.trim() || undefined)
            setDraft(draft.trim() || value)
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
      </label>
      {overridden && <button className="icon-button text-icon-button" type="button" onClick={onReset} title={t('text.useOriginal', { field: label })} aria-label={t('text.useOriginal', { field: label })}><RotateCcw size={14} /></button>}
    </div>
  )
}

function FontInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation()
  const [families, setFamilies] = useState(SUGGESTED_FONTS)
  useEffect(() => {
    let mounted = true
    void loadFontCatalog().then((available) => { if (mounted) setFamilies(available) })
    return () => { mounted = false }
  }, [])

  return <ComboboxField label={t('text.font')} value={value || DEFAULT_TEXT_FONT} options={families} onValueChange={onChange} />
}

export function TextInspector({ photo, frame }: TextInspectorProps) {
  const { t } = useTranslation()
  const { isOpen, open, toggle } = useInspectorSections()
  const updateFrame = useSessionStore((state) => state.updateFrame)
  const resetPhotoOverride = useSessionStore((state) => state.resetPhotoOverride)
  const setMetadata = useSessionStore((state) => state.setPhotoMetadataOverrides)
  const beginEdit = useSessionStore((state) => state.beginFrameEdit)
  const endEdit = useSessionStore((state) => state.endFrameEdit)
  const editMode = useSessionStore((state) => state.editMode)
  const corrections = useMetadataCorrections((state) => state.corrections)
  const select = useTextEditor((state) => state.select)
  const focus = useTextEditor((state) => state.metadataFocus)
  const guidesEnabled = useTextEditor((state) => state.guidesEnabled)
  const setGuidesEnabled = useTextEditor((state) => state.setGuidesEnabled)
  const selected = useSelectedTextIds(photo.id)
  const elements = getTextElements(frame)
  const selectedElements = elements.filter(({ id }) => selected.includes(id))
  const active = elements.find(({ id }) => id === selected.at(-1))
  const metadata = getEffectiveMetadata(photo, corrections)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const editor = useRef<HTMLTextAreaElement>(null)
  const variablesId = useId()

  useEffect(() => { void useTextEditor.getState().loadGuides() }, [])

  useEffect(() => {
    if (focus?.photoId === photo.id) {
      open('text')
      setMetadataOpen(true)
    }
  }, [focus, open, photo.id])

  const writeElements = (next: TextElement[]) => updateFrame('textElements', next)
  const updateElement = (id: string, patch: Partial<TextElement>) => writeElements(elements.map((element) => element.id === id ? { ...element, ...patch } : element))
  const choose = (id: string, extend: boolean) => {
    const next = extend
      ? selected.includes(id) ? selected.filter((key) => key !== id) : [...selected, id]
      : [id]
    select(photo.id, next)
  }

  const addElement = (template = '') => {
    const next = { ...createTextElement(template), anchor: 'bottom-left' as const, anchorMode: 'photo' as const, x: 34, y: -34, size: 28 }
    writeElements([...elements, next])
    select(photo.id, [next.id])
    requestAnimationFrame(() => editor.current?.focus())
  }

  const group = () => {
    const groupId = crypto.randomUUID()
    const oldGroups = new Set(selectedElements.flatMap(({ groupId }) => groupId ? [groupId] : []))
    writeElements(elements.map((element) => selected.includes(element.id) || (element.groupId && oldGroups.has(element.groupId)) ? { ...element, groupId } : element))
  }

  const ungroup = () => {
    const groups = new Set(selectedElements.flatMap(({ groupId }) => groupId ? [groupId] : []))
    writeElements(elements.map((element) => element.groupId && groups.has(element.groupId) ? { ...element, groupId: undefined } : element))
  }

  const insertVariable = (variable: string) => {
    if (!active) return
    const start = editor.current?.selectionStart ?? active.template.length
    const end = editor.current?.selectionEnd ?? start
    const token = `{${variable}}`
    updateElement(active.id, { template: active.template.slice(0, start) + token + active.template.slice(end) })
    requestAnimationFrame(() => {
      editor.current?.focus()
      editor.current?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const overrideMetadata = (field: MetadataField, value: string | undefined) => {
    if (photo.metadataOverrides?.[field] === value) return
    setMetadata(photo.id, { [field]: value } as Partial<PhotoMetadata>)
  }

  const changeAnchorMode = (element: TextElement, mode: 'photo' | 'canvas') => {
    const previousMode = element.anchorMode ?? 'canvas'
    if (previousMode === mode) return
    const roots = [...document.querySelectorAll<HTMLElement>('.text-overlay')]
    const root = roots.find((candidate) => candidate.dataset.photoId === photo.id
      && candidate.querySelector<HTMLElement>(`[data-text-id="${CSS.escape(element.id)}"]`))
    const layer = root?.querySelector<HTMLElement>(`[data-text-id="${CSS.escape(element.id)}"]`)
    const canvasSize = root && { width: root.clientWidth, height: root.clientHeight }
    const scale = canvasSize ? Math.min(canvasSize.width, canvasSize.height) / 1080 : 0
    let x = element.x
    let y = element.y
    if (root && layer && canvasSize && scale > 0) {
      const rootRect = root.getBoundingClientRect()
      const layerRect = layer.getBoundingClientRect()
      const [column, row] = getTextAnchorPosition(element.anchor)
      const oldPhotoRect = {
        x: Number(root.dataset.photoX ?? 0),
        y: Number(root.dataset.photoY ?? 0),
        width: Number(root.dataset.photoWidth ?? canvasSize.width),
        height: Number(root.dataset.photoHeight ?? canvasSize.height),
      }
      const newOrigin = mode === 'photo' ? oldPhotoRect : { x: 0, y: 0, ...canvasSize }
      const anchorX = layerRect.left - rootRect.left + column * layerRect.width
      const anchorY = layerRect.top - rootRect.top + row * layerRect.height
      x = (anchorX - newOrigin.x - column * newOrigin.width) / scale
      y = (anchorY - newOrigin.y - row * newOrigin.height) / scale
    }
    updateElement(element.id, { anchorMode: mode, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
  }

  return (
    <>
      <InspectorSection title={t('text.title')} open={isOpen('text')} onToggle={() => toggle('text')}>
        <div className="text-actions">
          <button className="button button--secondary button--small" type="button" onClick={() => addElement()}><Plus size={14} /> {t('text.new')}</button>
          <button className="button button--secondary button--small" type="button" onClick={() => addElement('{camera}\n{lens}\n{focal_length} · {aperture} · {shutter_speed} · ISO {iso}')}><Plus size={14} /> {t('text.addWatermark')}</button>
          {editMode === 'this' && photo.overrides.textElements && (
            <button className="icon-button text-icon-button" type="button" onClick={() => resetPhotoOverride(photo.id, 'textElements')} title={t('text.resetShared')} aria-label={t('text.resetShared')}><RotateCcw size={14} /></button>
          )}
        </div>
        <div className="text-actions">
          <button className="button button--secondary button--small" type="button" onClick={() => addElement('{camera}')}>{t('text.template.camera')}</button>
          <button className="button button--secondary button--small" type="button" onClick={() => addElement('{lens}')}>{t('text.template.lens')}</button>
          <button className="button button--secondary button--small" type="button" onClick={() => addElement('{focal_length} · {aperture} · {shutter_speed} · ISO {iso}')}>{t('text.template.exposure')}</button>
        </div>
        {elements.length > 0 && <ul className="text-layer-list">
          {elements.map((element) => {
            const missing = resolveTemplate(element.template, metadata).missing
            const missingLabel = t('text.missing', { fields: missing.map((key) => t(`text.metadata.${key}`)).join(', ') })
            const visibility = t(element.visible ? 'text.hide' : 'text.show')
            return (
              <li className={selected.includes(element.id) ? 'is-selected' : undefined} key={element.id}>
                <button className="text-layer-name" type="button" aria-pressed={selected.includes(element.id)} onClick={(event) => choose(element.id, event.shiftKey || event.metaKey || event.ctrlKey)}>
                  <span>{element.template || t('text.empty')}</span>
                  {element.groupId && <Group size={13} aria-label={t('text.grouped')} />}
                  {element.visible && missing.length > 0 && <small title={missingLabel}>{missingLabel}</small>}
                </button>
                <button className="icon-button text-icon-button" type="button" aria-label={visibility} title={visibility} onClick={() => updateElement(element.id, { visible: !element.visible })}>
                  {element.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </li>
            )
          })}
        </ul>}
        {active && <>
          <div className="text-actions">
            <button className="icon-button text-icon-button" type="button" disabled={selectedElements.length < 2} onClick={group} title={t('text.group')} aria-label={t('text.group')}><Group size={15} /></button>
            <button className="icon-button text-icon-button" type="button" disabled={!selectedElements.some(({ groupId }) => groupId)} onClick={ungroup} title={t('text.ungroup')} aria-label={t('text.ungroup')}><Ungroup size={15} /></button>
            <button className="icon-button text-icon-button" type="button" onClick={() => {
              writeElements(elements.filter(({ id }) => !selected.includes(id)))
              select(photo.id, [])
            }} title={t('text.remove')} aria-label={t('text.remove')}><Trash2 size={15} /></button>
          </div>
          <div className="text-fields">
            <label>{t('text.template')}
              <textarea className="text-field" ref={editor} value={active.template} rows={2} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateElement(active.id, { template: event.target.value })} />
            </label>
            <label className="visually-hidden" htmlFor={variablesId}>{t('text.variable')}</label>
            <SelectField className="text-field" id={variablesId} aria-label={t('text.variable')} placeholder={t('text.variable')} value=""
              onValueChange={(variable) => insertVariable(variable)}
              options={Object.keys(METADATA_VARIABLES).map((variable) => ({ value: variable, label: `{${variable}}` }))} />
            <label>{t('text.anchor')}
              <SelectField className="text-field" value={active.anchor} onValueChange={(value) => updateElement(active.id, { anchor: value as TextAnchor })}
                options={TEXT_ANCHORS.map((anchor) => ({ value: anchor, label: t(`text.anchor.${anchor}`) }))} />
            </label>
            <label>{t('text.anchorMode')}
              <SelectField className="text-field" value={active.anchorMode ?? 'canvas'} onValueChange={(value) => changeAnchorMode(active, value as 'photo' | 'canvas')}
                options={[{ value: 'photo', label: t('text.anchorMode.photo') }, { value: 'canvas', label: t('text.anchorMode.canvas') }]} />
            </label>
            <div className="text-field-pair">
              <OffsetInput label={t('text.horizontalOffset')} value={active.x} onChange={(x) => updateElement(active.id, { x })} />
              <OffsetInput label={t('text.verticalOffset')} value={active.y} onChange={(y) => updateElement(active.id, { y })} />
            </div>
          </div>
        </>}
        <details className="text-metadata" open={metadataOpen} onToggle={(event) => setMetadataOpen(event.currentTarget.open)}>
          <summary>{t('text.metadata')}</summary>
          <div className="text-fields">
            {Object.values(METADATA_VARIABLES).map((field) => <MetadataInput
              key={field}
              name={field}
              value={metadata[field] ?? ''}
              overridden={photo.metadataOverrides?.[field] !== undefined}
              focus={metadataOpen && focus?.photoId === photo.id && focus.field === field ? focus : undefined}
              onSave={(value) => overrideMetadata(field, value)}
              onReset={() => overrideMetadata(field, undefined)}
            />)}
          </div>
        </details>
      </InspectorSection>
      <InspectorSection title={t('text.typography')} open={isOpen('typography')} onToggle={() => toggle('typography')}>
        {active ? <>
          <div className="text-fields">
            <FontInput value={active.fontFamily} onChange={(fontFamily) => updateElement(active.id, { fontFamily })} />
            <label>{t('text.weight')}
              <SelectField className="text-field" value={String(active.weight)} onValueChange={(value) => updateElement(active.id, { weight: Number(value) })}
                options={weights.map((weight) => ({ value: String(weight), label: t(`text.weight.${weight}`) }))} />
            </label>
          </div>
          <SliderInput label={t('text.size')} value={active.size} min={8} max={160} unit="px" onChange={(size) => updateElement(active.id, { size })} onChangeStart={beginEdit} onChangeEnd={endEdit} />
          <SliderInput label={t('text.opacity')} value={active.opacity ?? 100} min={0} max={100} unit="%" onChange={(opacity) => updateElement(active.id, { opacity })} onChangeStart={beginEdit} onChangeEnd={endEdit} />
          <div className="text-color-controls">
            <div className="text-color-mode" role="group" aria-label={t('text.color')}>
              <button type="button" className={active.color === 'auto' ? 'is-active' : ''} aria-pressed={active.color === 'auto'} onClick={() => updateElement(active.id, { color: 'auto', customColor: active.color === 'auto' ? active.customColor : active.color })}>{t('text.auto')}</button>
              <button type="button" className={active.color !== 'auto' ? 'is-active' : ''} aria-pressed={active.color !== 'auto'} onClick={() => updateElement(active.id, { color: active.customColor ?? (active.color === 'auto' ? textColor('auto', frame.style, frame.customColor) : active.color) })}>{t('text.custom')}</button>
            </div>
            {active.color !== 'auto' && <CustomColorPicker title={t('text.textColor')} color={active.color} label={t('text.textColor')} onChange={(color) => updateElement(active.id, { color, customColor: color })} onEditStart={beginEdit} onEditEnd={endEdit} />}
          </div>
        </> : <p className="text-hint">{t('text.selectLayer')}</p>}
      </InspectorSection>
      <InspectorSection title={t('text.guides')} open={isOpen('guides')} onToggle={() => toggle('guides')}>
        <label className="text-guide-toggle"><input type="checkbox" checked={guidesEnabled} onChange={(event) => setGuidesEnabled(event.target.checked)} /> {t('text.smartGuides')}</label>
      </InspectorSection>
    </>
  )
}
