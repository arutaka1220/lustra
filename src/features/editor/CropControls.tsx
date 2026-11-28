import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fitCropRatio, INITIAL_CROP_TRANSFORM, ratioValue, resetCropTransform } from './crop-model'
import type { CropRect } from './crop-model'
import { ResetButton } from './ResetButton'

type Props = {
  crop?: CropRect
  sourceWidth: number
  sourceHeight: number
  onChange: (crop: CropRect) => void
  onApply: () => void
  onCancel: () => void
  onResetCrop?: () => void
  onResetRatio?: () => void
  onResetLock?: () => void
  onResetRotation?: () => void
}

function formatAngle(value: number) {
  return (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)
}

function parseAngle(value: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(-180, Math.min(180, parsed)) : undefined
}

export function CropControls({ crop: current, sourceWidth, sourceHeight, onChange, onApply, onCancel, onResetCrop, onResetRatio, onResetLock, onResetRotation }: Props) {
  const { t } = useTranslation()
  const crop = { ...INITIAL_CROP_TRANSFORM, ...current, rotation: current?.rotation ?? INITIAL_CROP_TRANSFORM.rotation! }
  const [rotationDraft, setRotationDraft] = useState(() => formatAngle(crop.rotation))
  const editingRotation = useRef(false)

  useEffect(() => {
    if (!editingRotation.current) setRotationDraft(formatAngle(crop.rotation))
  }, [crop.rotation])

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

  const resetCrop = () => {
    if (onResetCrop) onResetCrop()
    else onChange({ ...INITIAL_CROP_TRANSFORM })
  }
  const resetRatio = () => {
    if (onResetRatio) onResetRatio()
    else onChange(resetCropTransform(crop, 'ratio', sourceWidth, sourceHeight)!)
  }
  const resetLock = () => {
    if (onResetLock) onResetLock()
    else onChange(resetCropTransform(crop, 'lock', sourceWidth, sourceHeight)!)
  }
  const resetRotation = () => {
    if (onResetRotation) onResetRotation()
    else onChange(resetCropTransform(crop, 'rotation', sourceWidth, sourceHeight)!)
  }
  return <div className="controls-scroll crop-controls" aria-label={t('crop.mode')}>
    <div className="crop-controls__heading"><h2 className="crop-controls__title">{t('crop.mode')}</h2><ResetButton label={t('crop.mode')} onReset={resetCrop} /></div>
    <section className="crop-controls__section">
      <div className="field-label"><span className="crop-reset-field-label"><span>{t('crop.aspectRatio')}</span><ResetButton label={t('crop.aspectRatio')} onReset={resetRatio} /></span>
        <select aria-label={t('crop.aspectRatio')} value={crop.ratio ?? 'original'} onChange={event => {
          const ratio = event.target.value as NonNullable<CropRect['ratio']>
          const next = { ...crop, ratio }
          const value = ratioValue(ratio, sourceWidth, sourceHeight, crop.customRatio)
          onChange(value ? fitCropRatio(next, sourceWidth, sourceHeight, value) : next)
        }}>
          {['original', 'free', '1:1', '3:2', '4:3', '16:9', '9:16', 'custom'].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      {crop.ratio === 'custom' && <label className="field-label">{t('crop.customRatio')}
        <input aria-label={t('crop.customRatio')} type="number" min="0.01" step="0.01" value={crop.customRatio ?? sourceWidth / sourceHeight} onChange={event => {
          const customRatio = Number(event.target.value)
          if (!Number.isFinite(customRatio) || customRatio <= 0) return
          onChange({ ...fitCropRatio(crop, sourceWidth, sourceHeight, customRatio), ratio: 'custom', customRatio })
        }} />
      </label>}
      <div className="crop-controls__lock-reset"><label className="crop-controls__check"><input type="checkbox" aria-label={t('crop.lock')} checked={crop.locked !== false} onChange={event => onChange({ ...crop, locked: event.target.checked })} />{t('crop.lock')}</label><ResetButton label={t('crop.lock')} onReset={resetLock} /></div>
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
      <button type="button" className="button button--quiet crop-controls__reset" aria-label={t('crop.resetRotation')} onClick={resetRotation}>{t('crop.resetRotation')}</button>
      <div className="crop-controls__rotation-reset"><ResetButton label={t('crop.rotation')} onReset={resetRotation} /></div>
    </section>

    <div className="crop-controls__actions">
      <button type="button" className="button button--secondary" onClick={onCancel}>{t('crop.cancel')}</button>
      <button type="button" className="button button--primary" onClick={onApply}>{t('crop.apply')}</button>
    </div>
  </div>
}
