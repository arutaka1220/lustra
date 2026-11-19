import type { ReactNode } from 'react'
import { Check, Link2, Link2Off, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SliderInput } from './SliderInput'
import { InspectorSection } from './InspectorSection'
import { useInspectorSections } from './useInspectorSections'
import type { FrameSettings } from '../../types/photo'
import './frame-i18n'
import { hexToRgb, hsvToHex, parseHex, rgbToHex, rgbToHsv } from './color-utils'

type FrameControlsProps = {
  frame: FrameSettings
  onChange: <K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) => void
  onPatch?: (changes: Partial<FrameSettings>) => void
  onFrameEditStart?: () => void
  onFrameEditEnd?: () => void
  children?: ReactNode
}

const frameStyles = ['black', 'white', 'softWhite', 'blurred', 'custom'] as const
const sides = ['top', 'bottom', 'left', 'right'] as const
const oppositeSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const

export function FrameControls({ frame, onChange, onPatch, onFrameEditStart, onFrameEditEnd, children }: FrameControlsProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useInspectorSections()
  const sliderGestures = { onChangeStart: onFrameEditStart, onChangeEnd: onFrameEditEnd }
  const [palette, setPalette] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('lustra.myPalette') ?? '[]') } catch { return [] } })
  const [pickerOpen, setPickerOpen] = useState(false)
  const colorTrigger = useRef<HTMLButtonElement>(null)
  const closePicker = () => { setPickerOpen(false); requestAnimationFrame(() => colorTrigger.current?.focus()) }
  const [hexDraft, setHexDraft] = useState('')
  const color = parseHex(frame.customColor ?? '') ?? '#000000'
  const rgb = hexToRgb(color)!
  const hsv = rgbToHsv(rgb)
  const applyColor = (value: string) => { const valid = parseHex(value); if (valid) onChange('customColor', valid) }
  const pickField = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    applyColor(hsvToHex(hsv.h, Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), 100 - Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100))))
  }

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
    const next = !frame[key]
    if (next) {
      patch(key === 'linkSides' ? { linkSides: true, right: frame.left } : { linkVertical: true, bottom: frame.top })
    } else {
      onChange(key, false)
    }
  }
  const savePalette = (next: string[]) => { setPalette(next); localStorage.setItem('lustra.myPalette', JSON.stringify(next)) }

  return (
    <div className="controls-scroll">
      <InspectorSection title={t('edit.frame')} open={isOpen('frame')} onToggle={() => toggle('frame')}>
        <div className="style-picker">
          {frameStyles.map((style) => <button className={`style-option ${frame.style === style ? 'is-active' : ''}`} key={style}
            onClick={() => onChange('style', style)} aria-pressed={frame.style === style}>
            <span className={`style-preview style-preview--${style === 'blurred' ? 'blur' : style}`}><span /></span>
            <span>{t(`framePreview.${style}`)}</span>{frame.style === style && <Check size={14} aria-hidden="true" />}
          </button>)}
        </div>
        {frame.style === 'custom' && <div className="custom-color">
          <button ref={colorTrigger} className="custom-color__swatch" style={{ backgroundColor: frame.customColor ?? '#000000' }} onClick={() => setPickerOpen(!pickerOpen)} aria-label="Choose custom frame color" aria-expanded={pickerOpen} />
          <span>{frame.customColor ?? '#000000'}</span>
          {pickerOpen && <>
            <button className="custom-color__backdrop" aria-label="Close color picker" tabIndex={-1} onClick={closePicker} />
            <div className="custom-color__popover" role="dialog" aria-modal="true" aria-label="Custom frame color" onKeyDown={event => { if (event.key === 'Escape') closePicker() }}>
            <div className="custom-color__current" style={{ background: color }} aria-label={`Current color ${color}`} />
            <div className="custom-color__field" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`} onKeyDown={event => { if (event.key.startsWith('Arrow')) { event.preventDefault(); applyColor(hsvToHex(hsv.h, hsv.s + (event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0), hsv.v + (event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0))) } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pickField(event) }} onPointerMove={event => { if (event.buttons) pickField(event) }} style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }} />
            <label>Hue <input aria-label="Hue" type="range" min="0" max="359" value={hsv.h} onChange={e => applyColor(hsvToHex(Number(e.target.value), hsv.s, hsv.v))} /></label>
            <label>HEX <input aria-label="HEX" value={hexDraft || color} onChange={e => { setHexDraft(e.target.value); const valid = parseHex(e.target.value); if (valid) applyColor(valid) }} onBlur={() => setHexDraft('')} /></label>
            <div className="custom-color__rgb">{(['r','g','b'] as const).map(channel => <label key={channel}>{channel.toUpperCase()}<input aria-label={channel.toUpperCase()} type="number" min="0" max="255" value={rgb[channel]} onChange={e => applyColor(rgbToHex({ ...rgb, [channel]: Math.max(0, Math.min(255, Number(e.target.value))) }))} /></label>)}</div>
            <div className="custom-color__palette" aria-label={`My Palette ${palette.length} / 16`}>
              {palette.map(savedColor => <button key={savedColor} aria-label={`Apply ${savedColor}`} style={{ backgroundColor: savedColor }} onClick={() => applyColor(savedColor)} onContextMenu={e => { e.preventDefault(); const edited = prompt('Enter HEX to edit, or leave blank to delete', savedColor); if (edited === null) return; if (!edited.trim()) savePalette(palette.filter(c => c !== savedColor)); else { const valid = parseHex(edited); if (valid && !palette.includes(valid)) savePalette(palette.map(c => c === savedColor ? valid : c)) } }} />)}
              <button disabled={palette.length >= 16 || palette.includes(color)} aria-label="Add color to My Palette" title={palette.length >= 16 ? 'Palette is full' : 'Add current color'} onClick={() => savePalette([...palette, color])}><Plus size={14}/></button>
              <span>{palette.length} / 16</span>
            </div><button onClick={closePicker} aria-label="Close color picker"><X size={14}/></button>
            </div>
          </>}
        </div>}
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
