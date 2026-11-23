import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fitCropRatio, ratioValue } from './crop-model'
import type { CropRect } from './crop-model'
import './frame-i18n'

type Props = {
  crop?: CropRect
  sourceWidth: number
  sourceHeight: number
  onChange: (crop: CropRect) => void
  onApply: () => void
  onCancel: () => void
}

function formatAngle(value: number) {
  return (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)
}

function parseAngle(value: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(-180, Math.min(180, parsed)) : undefined
}

export function CropControls({ crop: current, sourceWidth, sourceHeight, onChange, onApply, onCancel }: Props) {
  const { t } = useTranslation()
  const crop = { x: 0, y: 0, width: 1, height: 1, ratio: 'original' as const, locked: true, ...current, rotation: current?.rotation ?? 0 }
  const [presets, setPresets] = useState<Record<string, CropRect>>(() => {
    try { return JSON.parse(localStorage.getItem('lustra.crop-presets.v1') ?? '{}') as Record<string, CropRect> } catch { return {} }
  })
  const [presetName, setPresetName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const [rotationDraft, setRotationDraft] = useState(() => formatAngle(crop.rotation))
  const editingRotation = useRef(false)

  useEffect(() => {
    if (!editingRotation.current) setRotationDraft(formatAngle(crop.rotation))
  }, [crop.rotation])

  const persistPresets = (next: Record<string, CropRect>) => {
    setPresets(next)
    try { localStorage.setItem('lustra.crop-presets.v1', JSON.stringify(next)) } catch { /* Storage may be unavailable in private contexts. */ }
  }
  const updateRotation = (value: string) => {
    setRotationDraft(value)
    const angle = parseAngle(value)
    if (angle !== undefined) onChange({ ...crop, rotation: angle })
  }
  const commitRotation = () => {
    editingRotation.current = false
    const angle = parseAngle(rotationDraft)
    if (angle === undefined) {
      setRotationDraft(formatAngle(crop.rotation))
      return
    }
    onChange({ ...crop, rotation: angle })
    setRotationDraft(formatAngle(angle))
  }
  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    persistPresets({ ...presets, [name]: structuredClone(crop) })
    setSelectedPreset(name)
  }
  const loadPreset = (name: string) => {
    setSelectedPreset(name)
    if (!presets[name]) return
    setPresetName(name)
    const preset = structuredClone(presets[name])
    const ratio = ratioValue(preset.ratio ?? 'original', sourceWidth, sourceHeight, preset.customRatio)
    onChange(ratio ? fitCropRatio(preset, sourceWidth, sourceHeight, ratio) : preset)
  }

  return <div className="controls-scroll crop-controls" aria-label={t('crop.mode')}>
    <h2 className="crop-controls__title">{t('crop.mode')}</h2>
    <section className="crop-controls__section">
      <label className="field-label">{t('crop.aspectRatio')}
        <select aria-label={t('crop.aspectRatio')} value={crop.ratio ?? 'original'} onChange={event => {
          const ratio = event.target.value as NonNullable<CropRect['ratio']>
          const next = { ...crop, ratio }
          const value = ratioValue(ratio, sourceWidth, sourceHeight, crop.customRatio)
          onChange(value ? fitCropRatio(next, sourceWidth, sourceHeight, value) : next)
        }}>
          {['original', 'free', '1:1', '3:2', '4:3', '16:9', '9:16', 'custom'].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {crop.ratio === 'custom' && <label className="field-label">{t('crop.customRatio')}
        <input aria-label={t('crop.customRatio')} type="number" min="0.01" step="0.01" value={crop.customRatio ?? sourceWidth / sourceHeight} onChange={event => {
          const customRatio = Number(event.target.value)
          if (!Number.isFinite(customRatio) || customRatio <= 0) return
          onChange({ ...fitCropRatio(crop, sourceWidth, sourceHeight, customRatio), ratio: 'custom', customRatio })
        }} />
      </label>}
      <label className="crop-controls__check"><input type="checkbox" aria-label={t('crop.lock')} checked={crop.locked !== false} onChange={event => onChange({ ...crop, locked: event.target.checked })} />{t('crop.lock')}</label>
    </section>

    <section className="crop-controls__section">
      <h3>{t('crop.rotation')}</h3>
      <div className="crop-controls__rotation">
        <input aria-label={`${t('crop.rotation')} slider`} type="range" min="-180" max="180" step="0.01" value={crop.rotation} onChange={event => onChange({ ...crop, rotation: Number(event.target.value) })} />
        <label className="crop-controls__angle">
          <input aria-label={t('crop.rotation')} type="text" inputMode="decimal" value={rotationDraft} onFocus={() => { editingRotation.current = true }} onChange={event => updateRotation(event.target.value)} onBlur={commitRotation} onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault(); event.stopPropagation(); commitRotation(); event.currentTarget.blur()
            }
          }} />
          <span aria-hidden="true">°</span>
        </label>
      </div>
      <output className="crop-controls__angle-readout" aria-label={t('crop.rotationValue')} aria-live="polite">{formatAngle(crop.rotation)}°</output>
      <button type="button" className="button button--quiet crop-controls__reset" aria-label={t('crop.resetRotation')} onClick={() => onChange({ ...crop, rotation: 0 })}>{t('crop.resetRotation')}</button>
    </section>

    <section className="crop-controls__section crop-controls__presets">
      <h3>{t('crop.presetSection')}</h3>
      <label className="field-label">{t('crop.presetName')}<input value={presetName} onChange={event => setPresetName(event.target.value)} placeholder={t('crop.presetName')} /></label>
      <button type="button" className="button button--quiet" disabled={!presetName.trim()} onClick={savePreset}>{t('crop.savePreset')}</button>
      <label className="field-label">{t('crop.presets')}
        <select aria-label={t('crop.presets')} value={selectedPreset} onChange={event => loadPreset(event.target.value)}>
          <option value="">{t('crop.loadPreset')}</option>{Object.keys(presets).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button type="button" className="button button--quiet" disabled={!selectedPreset || !presets[selectedPreset]} onClick={() => persistPresets({ ...presets, [selectedPreset]: structuredClone(crop) })}>{t('crop.update')}</button>
    </section>

    <div className="crop-controls__actions">
      <button type="button" className="button button--secondary" onClick={onCancel}>{t('crop.cancel')}</button>
      <button type="button" className="button button--primary" onClick={onApply}>{t('crop.apply')}</button>
    </div>
  </div>
}
