import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Link2, Link2Off, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SliderInput } from './SliderInput'
import { InspectorSection } from './InspectorSection'
import { useInspectorSections } from './useInspectorSections'
import { CANVAS_RATIOS, clampCrop, DEFAULT_CROP, MAX_CROP_ZOOM } from './frame-layout'
import type { CanvasRatio, FitMode, FrameSettings, PhotoCrop } from '../../types/photo'
import './frame-i18n'

type FrameControlsProps = {
  frame: FrameSettings
  onChange: <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => void
  onRatioChange: (ratio: CanvasRatio) => void
  onPatch?: (changes: Partial<FrameSettings>) => void
  onFrameEditStart?: () => void
  onFrameEditEnd?: () => void
  crop?: PhotoCrop
  effectiveFit?: FitMode
  onCropChange?: (crop: PhotoCrop) => void
  preset?: ReactNode
  children?: ReactNode
}

const frameStyles = ['black', 'white', 'blurred'] as const
const sides = ['top', 'bottom', 'left', 'right'] as const
const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const

function RatioField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return <input type="number" min={0.001} max={1000} step={0.001} inputMode="decimal" aria-label={label}
    value={draft ?? value.toFixed(3)} onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={() => {
      if (draft?.trim()) {
        const next = Number(draft)
        if (Number.isFinite(next)) onChange(Math.max(0.001, Math.min(1000, Number(next.toFixed(3)))))
      }
      setDraft(null)
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') setDraft(null)
    }} />
}

export function FrameControls({ frame, onChange, onRatioChange, onPatch, onFrameEditStart, onFrameEditEnd, crop: photoCrop, effectiveFit = frame.fit, onCropChange, preset, children }: FrameControlsProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useInspectorSections()
  const crop = clampCrop(photoCrop)
  const sliderGestures = { onChangeStart: onFrameEditStart, onChangeEnd: onFrameEditEnd }

  const patch = (changes: Partial<FrameSettings>) => {
    if (onPatch) {
      onPatch(changes)
      return
    }
    for (const key of Object.keys(changes) as (keyof FrameSettings)[]) {
      onChange(key, changes[key])
    }
  }

  const setMargin = (side: typeof sides[number], value: number) => {
    const linked = side === 'left' || side === 'right' ? frame.linkSides : frame.linkVertical
    patch(linked ? { [side]: value, [oppositeSide[side]]: value } : { [side]: value })
  }

  const toggleLink = (key: 'linkSides' | 'linkVertical') => {
    const next = !frame[key]
    if (next) {
      patch(key === 'linkSides' ? { linkSides: true, right: frame.left } : { linkVertical: true, bottom: frame.top })
    } else {
      onChange(key, false)
    }
  }

  return (
    <div className="controls-scroll">
      {preset}
      <InspectorSection title={t('edit.frame')} open={isOpen('frame')} onToggle={() => toggle('frame')}>
        <div className="style-picker">
          {frameStyles.map((style) => <button className={`style-option ${frame.style === style ? 'is-active' : ''}`} key={style}
            onClick={() => onChange('style', style)} aria-pressed={frame.style === style}>
            <span className={`style-preview style-preview--${style === 'blurred' ? 'blur' : style}`}><span /></span>
            <span>{t(`framePreview.${style}`)}</span>{frame.style === style && <Check size={14} aria-hidden="true" />}
          </button>)}
        </div>
      </InspectorSection>

      <InspectorSection title={t('edit.canvas')} open={isOpen('canvas')} onToggle={() => toggle('canvas')}>
        <div className="ratio-grid">
          {CANVAS_RATIOS.map((ratio) => (
            <button className={`ratio-option ${frame.ratio === ratio ? 'is-active' : ''}`} key={ratio} onClick={() => onRatioChange(ratio)} aria-pressed={frame.ratio === ratio}>
              {ratio === 'auto' || ratio === 'custom' ? t(`framePreview.${ratio}`) : ratio}
              {frame.ratio === ratio && <Check size={11} aria-hidden="true" />}
            </button>
          ))}
        </div>
        {frame.ratio === 'custom' && <div className="custom-ratio-fields" role="group" aria-label={t('framePreview.ratio')}>
          <RatioField label={t('framePreview.ratioWidth')} value={frame.ratioWidth ?? 1} onChange={(value) => onChange('ratioWidth', value)} />
          <span aria-hidden="true">×</span>
          <RatioField label={t('framePreview.ratioHeight')} value={frame.ratioHeight ?? 1} onChange={(value) => onChange('ratioHeight', value)} />
        </div>}
        <div className="fit-switch" role="group" aria-label={t('framePreview.fitMode')}>
          <button className={frame.fit === 'fit' ? 'is-active' : ''} onClick={() => onChange('fit', 'fit')} aria-pressed={frame.fit === 'fit'}>{t('framePreview.fit')} <small>{t('framePreview.fitHint')}</small></button>
          <button className={frame.fit === 'fill' ? 'is-active' : ''} onClick={() => onChange('fit', 'fill')} aria-pressed={frame.fit === 'fill'}>{t('framePreview.fill')} <small>{t('framePreview.fillHint')}</small></button>
        </div>
        {effectiveFit === 'fill' && onCropChange && <div className="crop-inspector">
          <small>{t('framePreview.dragCrop')}</small>
          <SliderInput label={t('framePreview.zoom')} value={Math.round(crop.zoom * 100)} min={100} max={MAX_CROP_ZOOM * 100}
            onChange={(zoom) => onCropChange({ ...crop, zoom: zoom / 100 })} {...sliderGestures} />
          <button className="button button--quiet button--compact" onClick={() => onCropChange(DEFAULT_CROP)}
            disabled={crop.x === 0 && crop.y === 0 && crop.zoom === 1}><RotateCcw size={14} aria-hidden="true" />{t('framePreview.resetCrop')}</button>
        </div>}
      </InspectorSection>

      <InspectorSection title={t('edit.margins')} open={isOpen('padding')} onToggle={() => toggle('padding')}>
        <div className="margin-control-grid">
          {sides.map((side) => <SliderInput key={side} label={t(`framePreview.${side}`)} value={frame[side]}
            max={side === 'bottom' && !frame.linkVertical ? 36 : 32} onChange={(value) => setMargin(side, value)} {...sliderGestures} />)}
        </div>
        <div className="link-row">
          {(['linkSides', 'linkVertical'] as const).map((key) => <button className={`link-toggle ${frame[key] ? 'is-on' : ''}`} key={key} onClick={() => toggleLink(key)} aria-pressed={frame[key]}>
            {frame[key] ? <Link2 size={16} aria-hidden="true" /> : <Link2Off size={16} aria-hidden="true" />}
            <span>{t(`framePreview.${key}`)}</span><span className="toggle-state">{t(frame[key] ? 'framePreview.on' : 'framePreview.off')}</span>
          </button>)}
        </div>
      </InspectorSection>

      <InspectorSection title={t('edit.appearance')} open={isOpen('effects')} onToggle={() => toggle('effects')}>
        {frame.style === 'blurred' && <>
          <SliderInput label={t('framePreview.blur')} value={frame.blurStrength} max={40} unit="px" onChange={(value) => onChange('blurStrength', value)} {...sliderGestures} />
          <SliderInput label={t('framePreview.brightness')} value={frame.backgroundBrightness} min={60} max={140} onChange={(value) => onChange('backgroundBrightness', value)} {...sliderGestures} />
          <SliderInput label={t('framePreview.opacity')} value={frame.backgroundOpacity ?? 100} max={100} onChange={(value) => onChange('backgroundOpacity', value)} {...sliderGestures} />
        </>}
        {(['showInset', 'showShadow'] as const).map((key) => <button className={`check-row ${frame[key] ? 'is-checked' : ''}`} key={key} onClick={() => onChange(key, !frame[key])} aria-pressed={frame[key]}>
          <span className="check-box">{frame[key] && <Check size={13} aria-hidden="true" />}</span>
          <span><strong>{t(key === 'showInset' ? 'framePreview.inset' : 'framePreview.shadow')}</strong></span>
        </button>)}
      </InspectorSection>
      {children}
    </div>
  )
}
