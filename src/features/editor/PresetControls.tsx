import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrameSettings } from '../../types/photo'
import { readAppPreference, writeAppPreference } from '../../store/session-persistence'
import { initialFrame } from '../../store/session-store'
import { getTextElements } from '../text/text-model'
import { InspectorSection } from './InspectorSection'
import { useInspectorSections } from './useInspectorSections'
import { SelectField } from '../../components/ui/SelectField'
import { hasLegacyCanvasSettings, withoutLegacyCanvasSettings } from './frame-migration'

type Preset = { id: string; name: string; frame: FrameSettings }
type PresetAction = 'new' | 'delete' | null
const preferenceKey = 'frame.presets'

function presetFrame(frame: FrameSettings): FrameSettings {
  const compatible = withoutLegacyCanvasSettings(frame)
  return { ...initialFrame, ...compatible, textElements: getTextElements(frame) }
}

export function PresetControls({ frame, onApply }: { frame: FrameSettings; onApply: (frame: FrameSettings) => void }) {
  const { t } = useTranslation()
  const sections = useInspectorSections()
  const [presets, setPresets] = useState<Preset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [ready, setReady] = useState(false)
  const [action, setAction] = useState<PresetAction>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const selected = presets.find((item) => item.id === selectedId)
  const hasChanges = Boolean(selected && JSON.stringify(presetFrame(selected.frame)) !== JSON.stringify(presetFrame(frame)))
  const nameInUse = presets.some((item) => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())

  useEffect(() => {
    let disposed = false
    void readAppPreference<Preset[]>(preferenceKey).then((saved) => {
      if (disposed) return
      const loaded = Array.isArray(saved) ? saved : []
      const normalized = loaded.map((preset) => ({ ...preset, frame: presetFrame(preset.frame) }))
      setPresets(normalized)
      setLoadFailed(false)
      setReady(true)
      if (loaded.some((preset) => hasLegacyCanvasSettings(preset.frame))) {
        void writeAppPreference(preferenceKey, normalized).catch((error) => console.warn('Could not migrate frame presets', error))
      }
    }).catch(() => {
      if (!disposed) setLoadFailed(true)
    })
    return () => { disposed = true }
  }, [loadAttempt])

  async function persist(next: Preset[], id: string) {
    setReady(false)
    setError(false)
    try {
      await writeAppPreference(preferenceKey, next)
      setPresets(next)
      setSelectedId(id)
      setAction(null)
    } catch {
      setError(true)
    } finally {
      setReady(true)
    }
  }

  function saveNew() {
    if (!name.trim() || nameInUse) return
    const preset = { id: crypto.randomUUID(), name: name.trim(), frame: presetFrame(frame) }
    void persist([...presets, preset], preset.id)
  }

  return <InspectorSection title={t('preset.title')} open={sections.isOpen('preset')} onToggle={() => sections.toggle('preset')}>
    <div className="preset-controls">
      <SelectField aria-label={t('preset.title')} disabled={!ready} value={selectedId} placeholder={t('preset.none')} onValueChange={(value) => {
        const item = presets.find((preset) => preset.id === value)
        setSelectedId(value)
        if (item) onApply(presetFrame(item.frame))
      }} options={presets.map((item) => ({ value: item.id, label: item.name }))} />
      {hasChanges && <span className="muted">{t('preset.modified')}</span>}
      <div className="preset-actions">
        <button className="button button--secondary button--small" disabled={!ready} onClick={() => { setName(''); setAction('new') }}>{t('preset.saveNew')}</button>
        {selected && <>
          <button className="button button--quiet button--small" disabled={!hasChanges || !ready} onClick={() => void persist(presets.map((item) => item.id === selected.id ? { ...item, frame: presetFrame(frame) } : item), selected.id)}>{t('preset.update')}</button>
          <button className="button button--quiet button--small" disabled={!ready} onClick={() => setAction('delete')}>{t('preset.delete')}</button>
        </>}
      </div>
      {error && !action && <span className="workflow-error" role="alert">{t('preset.saveError')}</span>}
      {loadFailed && <div>
        <span className="workflow-error" role="alert">{t('preset.loadError')}</span>
        <button className="text-button" onClick={() => { setLoadFailed(false); setLoadAttempt((attempt) => attempt + 1) }}>{t('common.retry')}</button>
      </div>}
      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open && ready) setAction(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="settings-dialog">
            <Dialog.Title className="dialog-title">{t(action === 'delete' ? 'preset.delete' : 'preset.saveNew')}</Dialog.Title>
            <Dialog.Description className="dialog-description">{t(action === 'delete' ? 'preset.deleteBody' : 'preset.name', { name: selected?.name })}</Dialog.Description>
            <form onSubmit={(event) => {
              event.preventDefault()
              if (action === 'delete' && selected) void persist(presets.filter((item) => item.id !== selected.id), '')
              else saveNew()
            }}>
              {action === 'new' && <input className="workflow-input" autoFocus aria-label={t('preset.name')} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />}
              {nameInUse && action === 'new' && <p className="workflow-error">{t('preset.duplicate')}</p>}
              {error && <p className="workflow-error" role="alert">{t('preset.saveError')}</p>}
              <div className="dialog-actions">
                <Dialog.Close asChild><button type="button" className="button button--quiet" disabled={!ready}>{t('common.cancel')}</button></Dialog.Close>
                <button className="button button--primary" disabled={!ready || (action === 'new' && (!name.trim() || nameInUse))}>{t(action === 'delete' ? 'common.delete' : 'common.save')}</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  </InspectorSection>
}
