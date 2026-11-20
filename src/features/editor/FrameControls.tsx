import type { ReactNode } from 'react'
import { Check, Link2, Link2Off } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SliderInput } from './SliderInput'
import { InspectorSection } from './InspectorSection'
import { useInspectorSections } from './useInspectorSections'
import type { FrameSettings } from '../../types/photo'
import './frame-i18n'
import { CustomColorPicker } from './CustomColorPicker'

type FrameControlsProps = {
  frame: FrameSettings
  onChange: <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => void
  onPatch?: (changes: Partial<FrameSettings>) => void
  onFrameEditStart?: () => void
  onFrameEditEnd?: () => void
  children?: ReactNode
}

export const FRAME_STYLE_ORDER = ['black', 'white', 'blurred', 'softBlack', 'softWhite', 'custom'] as const
const sides = ['top', 'bottom', 'left', 'right'] as const
const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const

export function FrameControls({ frame, onChange, onPatch, onFrameEditStart, onFrameEditEnd, children }: FrameControlsProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useInspectorSections()
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

  const setPadding = (side: typeof sides[number], value: number) => {
    const linked = side === 'left' || side === 'right' ? frame.linkSides : frame.linkVertical
    patch(linked ? { [side]: value, [oppositeSide[side]]: value } : { [side]: value })
  }

  const toggleLink = (key: 'linkSides' | 'linkVertical') => {
    patch({ [key]: !frame[key] })
  }
  return (
    <div className="controls-scroll">
      <InspectorSection title={t('edit.frame')} open={isOpen('frame')} onToggle={() => toggle('frame')}>
        <div className="style-picker">
          {FRAME_STYLE_ORDER.map((style) => style === 'custom'
            ? <CustomColorPicker key={style} tile selected={frame.style === 'custom'} label={t('framePreview.custom')} color={frame.customColor ?? '#000000'} onOpen={() => onChange('style', 'custom')} onChange={color => onChange('customColor', color)} onEditStart={onFrameEditStart} onEditEnd={onFrameEditEnd} />
            : <button className={`style-option ${frame.style === style ? 'is-active' : ''}`} key={style}
              onClick={() => onChange('style', style)} aria-pressed={frame.style === style}>
              <span className={`style-preview style-preview--${style === 'blurred' ? 'blur' : style}`}><span /></span>
              <span>{t(`framePreview.${style}`)}</span>{frame.style === style && <Check size={14} aria-hidden="true" />}
            </button>)}
        </div>
      </InspectorSection>

      <InspectorSection title={t('edit.padding')} open={isOpen('padding')} onToggle={() => toggle('padding')}>
        <p className="padding-help">{t('framePreview.paddingHelp')}</p>
        {(['linkVertical', 'linkSides'] as const).map((key) => <section className="padding-group" key={key}>
          <header><strong>{t(key === 'linkVertical' ? 'framePreview.vertical' : 'framePreview.horizontal')}</strong><button className={`link-toggle ${frame[key] ? 'is-on' : ''}`} onClick={() => toggleLink(key)} aria-pressed={frame[key]}>
            {frame[key] ? <Link2 size={16} aria-hidden="true" /> : <Link2Off size={16} aria-hidden="true" />}
            <span>{t(`framePreview.${key}`)}</span><span className="toggle-state">{t(frame[key] ? 'framePreview.on' : 'framePreview.off')}</span>
          </button></header><div className="margin-control-grid">{(key === 'linkVertical' ? sides.slice(0, 2) : sides.slice(2)).map((side) => <SliderInput key={side} label={t(`framePreview.${side}`)} value={frame[side]} max={32} onChange={(value) => setPadding(side, value)} {...sliderGestures} />)}</div>
        </section>)}
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
