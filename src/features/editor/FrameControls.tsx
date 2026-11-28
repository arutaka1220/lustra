import { type CSSProperties, type ReactNode } from 'react'
import { Check, Link2, Link2Off } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SliderInput } from './SliderInput'
import { InspectorSection } from './InspectorSection'
import { useInspectorSections } from './useInspectorSections'
import type { FrameSettings, FrameStyle } from '../../types/photo'
import { CustomColorPicker } from './CustomColorPicker'
import { SelectField } from '../../components/ui/SelectField'
import { autoFrameTextColor } from '../text/text-model'
import { initialFrame, initialPortraitCardSettings } from '../../store/session-store'
import { ResetButton } from './ResetButton'

const frameStyleName = {
  none: 'none', black: 'black', white: 'white', blurred: 'blur', softBlack: 'softBlack',
  softWhite: 'softWhite', custom: 'custom', ambientGradient: 'ambientGradient', edgeStretch: 'edgeStretch',
} as const satisfies Record<FrameStyle, keyof typeof import('../../i18n/common').common.frames>

type FrameControlsProps = {
  frame: FrameSettings
  onChange: <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => void
  onPatch?: (changes: Partial<FrameSettings>) => void
  onFrameEditStart?: () => void
  onFrameEditEnd?: () => void
  onResetCategory?: (category: 'canvas' | 'frame' | 'padding' | 'effects') => void
  onResetSetting?: (key: keyof FrameSettings, value: FrameSettings[keyof FrameSettings]) => void
  onResetTextColor?: () => void
  children?: ReactNode
}

export const FRAME_STYLE_ORDER = ['none', 'black', 'white', 'blurred', 'softBlack', 'softWhite', 'ambientGradient', 'edgeStretch', 'custom'] as const
const sides = ['top', 'bottom', 'left', 'right'] as const
const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const

export function FrameControls({ frame, onChange, onPatch, onFrameEditStart, onFrameEditEnd, onResetCategory, onResetSetting, onResetTextColor, children }: FrameControlsProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useInspectorSections()
  const isPortraitCard = frame.canvasLayout === 'portraitCard'
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
  const autoTextColor = frame.autoTextColor !== false
  const automaticTextColor = autoFrameTextColor(frame.style, frame.customColor)
  const displayedTextColor = autoTextColor ? automaticTextColor : frame.manualTextColor ?? automaticTextColor
  const changeManualTextColor = (color: string) => patch({ autoTextColor: false, manualTextColor: color })
  return (
    <div className="controls-scroll">
      <InspectorSection title={t('framePreview.canvas')} open={isOpen('canvas')} onToggle={() => toggle('canvas')} onReset={onResetCategory ? () => onResetCategory('canvas') : undefined}>
        <div className="portrait-canvas-field">
          <span className="resettable-label"><span>{t('framePreview.canvasLayout')}</span><ResetButton label={t('framePreview.canvasLayout')} onReset={() => onResetSetting?.('canvasLayout', initialFrame.canvasLayout)} /></span>
          <SelectField aria-label={t('framePreview.canvasLayout')} value={frame.canvasLayout ?? 'standard'} options={[
            { value: 'standard', label: t('framePreview.standardLayout') },
            { value: 'portraitCard', label: t('framePreview.portraitCardLayout') },
          ]} onValueChange={value => {
            const layout = value as 'standard' | 'portraitCard'
            if (layout === 'portraitCard') {
              patch({
                canvasLayout: layout,
                portraitRatio: frame.portraitRatio ?? initialPortraitCardSettings.portraitRatio,
                portraitPhotoSize: frame.portraitPhotoSize ?? initialPortraitCardSettings.portraitPhotoSize,
                portraitVerticalPosition: frame.portraitVerticalPosition ?? initialPortraitCardSettings.portraitVerticalPosition,
                portraitBackgroundStyle: frame.portraitBackgroundStyle ?? initialPortraitCardSettings.portraitBackgroundStyle,
                portraitBackgroundCustomColor: frame.portraitBackgroundCustomColor ?? initialPortraitCardSettings.portraitBackgroundCustomColor,
                portraitBackgroundBlur: frame.portraitBackgroundBlur ?? initialPortraitCardSettings.portraitBackgroundBlur,
                portraitBackgroundBrightness: frame.portraitBackgroundBrightness ?? initialPortraitCardSettings.portraitBackgroundBrightness,
              })
            } else {
              patch({ canvasLayout: layout })
            }
          }} />
        </div>
        {isPortraitCard && <div className="portrait-canvas-field">
          <span className="resettable-label"><span>{t('framePreview.canvasRatio')}</span><ResetButton label={t('framePreview.canvasRatio')} onReset={() => onResetSetting?.('portraitRatio', initialPortraitCardSettings.portraitRatio!)} /></span>
          <SelectField aria-label={t('framePreview.canvasRatio')} value={String(frame.portraitRatio ?? initialPortraitCardSettings.portraitRatio)} options={[
            { value: String(4 / 5), label: '4:5' },
            { value: String(3 / 4), label: '3:4' },
            { value: String(9 / 16), label: '9:16' },
            { value: '1', label: '1:1' },
          ]} onValueChange={value => onChange('portraitRatio', Number(value))} />
        </div>}
      </InspectorSection>
      <InspectorSection title={t('edit.frame')} open={isOpen('frame')} onToggle={() => toggle('frame')} onReset={onResetCategory ? () => onResetCategory('frame') : undefined}>
        <div className="style-picker">
          {FRAME_STYLE_ORDER.map((style) => style === 'custom'
            ? <CustomColorPicker key={style} tile selected={frame.style === 'custom'} label={t('frames.custom', { ns: 'common' })} color={frame.customColor ?? '#000000'} onOpen={() => onChange('style', 'custom')} onChange={color => onChange('customColor', color)} onEditStart={onFrameEditStart} onEditEnd={onFrameEditEnd} />
            : <button className={`style-option ${frame.style === style ? 'is-active' : ''}`} key={style}
              onClick={() => onChange('style', style)} aria-pressed={frame.style === style}>
              <span className={`style-preview style-preview--${style === 'blurred' ? 'blur' : style}`}><span /></span>
              <span>{t(`frames.${frameStyleName[style]}`, { ns: 'common' })}</span>{frame.style === style && <Check size={14} aria-hidden="true" />}
            </button>)}
        </div>
        <section className="frame-text-color" aria-label={t('framePreview.textColor')}>
          <header className="frame-text-color__header">
            <strong>{t('framePreview.textColor')}</strong>
            {onResetTextColor && <ResetButton label={t('framePreview.textColor')} onReset={onResetTextColor} />}
            <label className="frame-text-color__auto">
              <span>{t('framePreview.auto')}</span>
              <button type="button" role="switch" aria-label={t('framePreview.autoTextColor')} aria-checked={autoTextColor}
                className={`switch ${autoTextColor ? 'is-on' : ''}`}
                onClick={() => patch(autoTextColor
                  ? { autoTextColor: false, manualTextColor: frame.manualTextColor ?? automaticTextColor }
                  : { autoTextColor: true })}>
                <span />
              </button>
            </label>
          </header>
          <div className={`frame-text-color__palette ${autoTextColor ? 'is-auto' : ''}`}>
            {(['#FFFFFF', '#000000'] as const).map((color) => <button key={color} type="button" className={`frame-text-color__swatch ${displayedTextColor.toUpperCase() === color ? 'is-selected' : ''}`}
              style={{ '--swatch-color': color } as CSSProperties} aria-label={color === '#FFFFFF' ? t('framePreview.textWhite') : t('framePreview.textBlack')}
              aria-pressed={displayedTextColor.toUpperCase() === color} disabled={autoTextColor}
              onClick={() => changeManualTextColor(color)}><span /></button>)}
            <CustomColorPicker compact disabled={autoTextColor} title={t('framePreview.textColor')} label={t('framePreview.textColor')}
              color={displayedTextColor} selected={!autoTextColor && !['#FFFFFF', '#000000'].includes((frame.manualTextColor ?? '').toUpperCase())}
              onChange={changeManualTextColor} onEditStart={onFrameEditStart} onEditEnd={onFrameEditEnd} />
            <span className="frame-text-color__value" aria-live="polite">{displayedTextColor}</span>
          </div>
        </section>
      </InspectorSection>

      {frame.canvasLayout !== 'portraitCard' && <InspectorSection title={t('edit.padding')} open={isOpen('padding')} onToggle={() => toggle('padding')} onReset={onResetCategory ? () => onResetCategory('padding') : undefined}>
        <p className="padding-help">{t('framePreview.paddingHelp')}</p>
        <p className="padding-help">{t('framePreview.paddingSameAspect')}</p>
        {(['linkVertical', 'linkSides'] as const).map((key) => <section className="padding-group" key={key}>
          <header><strong>{t(key === 'linkVertical' ? 'framePreview.vertical' : 'framePreview.horizontal')}</strong><ResetButton label={t(key === 'linkVertical' ? 'framePreview.vertical' : 'framePreview.horizontal')} onReset={() => onResetSetting?.(key, initialFrame[key])} /><button className={`link-toggle ${frame[key] ? 'is-on' : ''}`} onClick={() => toggleLink(key)} aria-pressed={frame[key]}>
            {frame[key] ? <Link2 size={16} aria-hidden="true" /> : <Link2Off size={16} aria-hidden="true" />}
            <span>{t(`framePreview.${key}`)}</span><span className="toggle-state">{t(frame[key] ? 'framePreview.on' : 'framePreview.off')}</span>
          </button></header><div className="margin-control-grid">{(key === 'linkVertical' ? sides.slice(0, 2) : sides.slice(2)).map((side) => <SliderInput key={side} label={t(`framePreview.${side}`)} value={frame[side]} max={32} onChange={(value) => setPadding(side, value)} onReset={() => onResetSetting?.(side, initialFrame[side])} {...sliderGestures} />)}</div>
        </section>)}
      </InspectorSection>}

      <InspectorSection title={t('edit.appearance')} open={isOpen('effects')} onToggle={() => toggle('effects')} onReset={onResetCategory ? () => onResetCategory('effects') : undefined}>
        {isPortraitCard && <>
          <SliderInput label={t('framePreview.photoSize')} value={frame.portraitPhotoSize ?? initialPortraitCardSettings.portraitPhotoSize!} min={40} max={90} unit="%" onChange={value => onChange('portraitPhotoSize', value)} onReset={() => onResetSetting?.('portraitPhotoSize', initialPortraitCardSettings.portraitPhotoSize!)} {...sliderGestures} />
          <SliderInput label={t('framePreview.verticalPosition')} value={frame.portraitVerticalPosition ?? initialPortraitCardSettings.portraitVerticalPosition!} min={-0.5} max={0.5} step={0.01} unit="" onChange={value => onChange('portraitVerticalPosition', value)} onReset={() => onResetSetting?.('portraitVerticalPosition', initialPortraitCardSettings.portraitVerticalPosition!)} {...sliderGestures} />
          <button className="button button--quiet portrait-reset-position" type="button" onClick={() => onChange('portraitVerticalPosition', 0)}>{t('framePreview.resetPosition')}</button>
        </>}
        {isPortraitCard && frame.style === 'blurred' && <>
          <SliderInput label={t('framePreview.backgroundBlur')} value={frame.portraitBackgroundBlur ?? initialPortraitCardSettings.portraitBackgroundBlur!} max={40} unit="px" onChange={value => onChange('portraitBackgroundBlur', value)} onReset={() => onResetSetting?.('portraitBackgroundBlur', initialPortraitCardSettings.portraitBackgroundBlur!)} {...sliderGestures} />
          <SliderInput label={t('framePreview.backgroundBrightness')} value={frame.portraitBackgroundBrightness ?? initialPortraitCardSettings.portraitBackgroundBrightness!} min={60} max={140} onChange={value => onChange('portraitBackgroundBrightness', value)} onReset={() => onResetSetting?.('portraitBackgroundBrightness', initialPortraitCardSettings.portraitBackgroundBrightness!)} {...sliderGestures} />
        </>}
        {frame.style === 'blurred' && !isPortraitCard && <>
          <SliderInput label={t('framePreview.blur')} value={frame.blurStrength} max={40} unit="px" onChange={(value) => onChange('blurStrength', value)} onReset={() => onResetSetting?.('blurStrength', initialFrame.blurStrength)} {...sliderGestures} />
          <SliderInput label={t('framePreview.brightness')} value={frame.backgroundBrightness} min={60} max={140} onChange={(value) => onChange('backgroundBrightness', value)} onReset={() => onResetSetting?.('backgroundBrightness', initialFrame.backgroundBrightness)} {...sliderGestures} />
          <SliderInput label={t('framePreview.opacity')} value={frame.backgroundOpacity ?? 100} max={100} onChange={(value) => onChange('backgroundOpacity', value)} onReset={() => onResetSetting?.('backgroundOpacity', initialFrame.backgroundOpacity)} {...sliderGestures} />
        </>}
        {frame.style === 'ambientGradient' && <>
          <SliderInput label={t('framePreview.intensity')} value={frame.ambientIntensity ?? initialFrame.ambientIntensity!} max={100} unit="%" onChange={value => onChange('ambientIntensity', value)} onReset={() => onResetSetting?.('ambientIntensity', initialFrame.ambientIntensity!)} {...sliderGestures} />
          <SliderInput label={t('framePreview.softness')} value={frame.ambientSoftness ?? initialFrame.ambientSoftness!} max={100} unit="%" onChange={value => onChange('ambientSoftness', value)} onReset={() => onResetSetting?.('ambientSoftness', initialFrame.ambientSoftness!)} {...sliderGestures} />
          <SliderInput label={t('framePreview.ambientBrightness')} value={frame.ambientBrightness ?? initialFrame.ambientBrightness!} min={-100} max={100} onChange={value => onChange('ambientBrightness', value)} onReset={() => onResetSetting?.('ambientBrightness', initialFrame.ambientBrightness!)} {...sliderGestures} />
          <div className="field-label"><span className="resettable-label"><span>{t('framePreview.colorSource')}</span><ResetButton label={t('framePreview.colorSource')} onReset={() => onResetSetting?.('ambientColorSource', initialFrame.ambientColorSource!)} /></span><select aria-label={t('framePreview.colorSource')} value={frame.ambientColorSource ?? initialFrame.ambientColorSource!} onChange={event => onChange('ambientColorSource', event.target.value as 'fullImage' | 'edges')}><option value="fullImage">{t('framePreview.fullImage')}</option><option value="edges">{t('framePreview.edges')}</option></select></div>
        </>}
        {frame.style === 'edgeStretch' && <>
          <div className="field-label"><span className="resettable-label"><span>{t('framePreview.stretchMode')}</span><ResetButton label={t('framePreview.stretchMode')} onReset={() => onResetSetting?.('edgeStretchMode', initialFrame.edgeStretchMode!)} /></span><select aria-label={t('framePreview.stretchMode')} value={frame.edgeStretchMode ?? initialFrame.edgeStretchMode!} onChange={event => onChange('edgeStretchMode', event.target.value as 'extend' | 'mirror')}><option value="extend">{t('framePreview.extend')}</option><option value="mirror">{t('framePreview.mirror')}</option></select></div>
          <SliderInput label={t('framePreview.edgeBlur')} value={frame.edgeStretchBlur ?? initialFrame.edgeStretchBlur!} max={40} unit="px" onChange={value => onChange('edgeStretchBlur', value)} onReset={() => onResetSetting?.('edgeStretchBlur', initialFrame.edgeStretchBlur!)} {...sliderGestures} />
          <SliderInput label={t('framePreview.fade')} value={frame.edgeStretchFade ?? initialFrame.edgeStretchFade!} max={40} unit="px" onChange={value => onChange('edgeStretchFade', value)} onReset={() => onResetSetting?.('edgeStretchFade', initialFrame.edgeStretchFade!)} {...sliderGestures} />
        </>}
        {frame.canvasLayout !== 'portraitCard' && (['showInset', 'showShadow'] as const).map((key) => <div className="check-row-wrap" key={key}>
          <button className={`check-row ${frame[key] ? 'is-checked' : ''}`} onClick={() => onChange(key, !frame[key])} aria-pressed={frame[key]}>
            <span className="check-box">{frame[key] && <Check size={13} aria-hidden="true" />}</span>
            <span><strong>{t(key === 'showInset' ? 'framePreview.inset' : 'framePreview.shadow')}</strong></span>
          </button>
          <ResetButton label={t(key === 'showInset' ? 'framePreview.inset' : 'framePreview.shadow')} onReset={() => onResetSetting?.(key, initialFrame[key])} />
        </div>)}
      </InspectorSection>
      {children}
    </div>
  )
}
