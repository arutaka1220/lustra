import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clipboard, Plus, X } from 'lucide-react'
import { hexToRgb, hsvToHex, parseHex, rgbToHex, rgbToHsv } from './color-utils'
import { useMyPalette } from './MyPalette'
import './custom-color-picker.css'

type Props = {
  color: string
  onChange: (color: string) => void
  onOpen?: () => void
  tile?: boolean
  selected?: boolean
  label?: string
  title?: string
  onEditStart?: () => void
  onEditEnd?: () => void
}

type Point = { top: number; left: number; placement: 'right' | 'left' }

export function CustomColorPicker({ color: rawColor, onChange, onOpen, tile = false, selected = false, label = 'Custom', title = 'Frame Color', onEditStart, onEditEnd }: Props) {
  const color = parseHex(rawColor) ?? '#000000'
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const activeEdit = useRef(false)
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState<Point>({ top: 12, left: 300, placement: 'right' })
  const [mode, setMode] = useState<'HEX' | 'RGB'>('HEX')
  const [hexDraft, setHexDraft] = useState(color)
  const [rgbDraft, setRgbDraft] = useState<{ r: string; g: string; b: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [palette, updatePalette] = useMyPalette()
  const colorSource = useRef<'hex' | 'rgb' | 'external'>('external')
  const rgb = hexToRgb(color)!
  const hsv = rgbToHsv(rgb)

  const begin = () => { if (!activeEdit.current) { activeEdit.current = true; onEditStart?.() } }
  const end = () => { if (activeEdit.current) { activeEdit.current = false; onEditEnd?.() } }
  const apply = (value: string, source: 'hex' | 'rgb' | 'external' = 'external') => {
    const parsed = parseHex(value)
    if (!parsed) return
    begin()
    if (parsed === color) { colorSource.current = 'external'; return }
    colorSource.current = source
    if (source !== 'hex') setHexDraft(parsed)
    if (source !== 'rgb') setRgbDraft(null)
    onChange(parsed)
  }

  const position = () => {
    const anchor = trigger.current?.getBoundingClientRect()
    if (!anchor) return
    const width = 336
    const gap = 10
    const margin = 12
    const right = anchor.right + gap
    const left = right + width <= window.innerWidth - margin ? right : Math.max(margin, anchor.left - gap - width)
    const placement = left >= anchor.left ? 'right' : 'left'
    const estimatedHeight = Math.min(640, window.innerHeight - margin * 2)
    const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - estimatedHeight - margin))
    setPoint({ top, left, placement })
  }

  useEffect(() => {
    if (!open) return
    position()
    const onPointerDown = (event: PointerEvent) => {
      if (popover.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return
      end(); setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); end(); setOpen(false); trigger.current?.focus() }
    }
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (colorSource.current === 'external') { setHexDraft(color); setRgbDraft(null) }
    colorSource.current = 'external'
  }, [color])
  const setHue = (hue: number) => { begin(); apply(hsvToHex(hue, hsv.s, hsv.v)) }
  const pickField = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const s = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
    const v = 100 - Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    begin(); apply(hsvToHex(hsv.h, s, v))
  }
  const saveCurrent = () => {
    if (palette.length >= 16 || palette.includes(color)) return
    updatePalette([...palette, color])
  }
  const editSaved = (saved: string) => {
    const next = window.prompt('Enter a new HEX color', saved)
    if (next === null) return
    const parsed = parseHex(next)
    if (!parsed || (parsed !== saved && palette.includes(parsed))) return
    updatePalette(palette.map(entry => entry === saved ? parsed : entry))
  }
  const removeSaved = (saved: string) => updatePalette(palette.filter(entry => entry !== saved))
  const copy = async () => {
    try { await navigator.clipboard.writeText(color); setCopied(true); window.setTimeout(() => setCopied(false), 1200) } catch { /* clipboard may be unavailable in restricted contexts */ }
  }

  return <>
    <button ref={trigger} type="button" className={tile ? `style-option custom-color__tile ${selected ? 'is-active' : ''}` : 'custom-color__trigger'} aria-label={tile ? `${label} frame color` : `Choose custom ${title.toLowerCase()}`} aria-expanded={open} aria-pressed={tile ? selected : undefined} onClick={() => { onOpen?.(); setHexDraft(color); position(); setOpen(true) }}>
      {tile ? <><span className="style-preview style-preview--custom" style={{ '--custom-frame-color': color } as React.CSSProperties}><span /></span><span>{label}</span></> : <><span className="custom-color__trigger-swatch" style={{ backgroundColor: color }} /><span className="custom-color__trigger-value">{color}</span><span className="custom-color__trigger-chevron" aria-hidden="true">⌄</span></>}
      {tile && selected && <Check className="custom-color__tile-check" size={14} aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={popover} className="custom-color__popover" role="dialog" aria-label={title} data-placement={point.placement} style={{ top: point.top, left: point.left }}>
      <header className="custom-color__header"><h2>{title}</h2><button type="button" className="custom-color__close" aria-label="Close color picker" onClick={() => { end(); setOpen(false); trigger.current?.focus() }}><X size={17}/></button></header>
      <div ref={field} className="custom-color__field" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`} onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return
        event.preventDefault(); begin()
        const step = event.shiftKey ? 10 : 2
        const s = hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)
        const v = hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)
        apply(hsvToHex(hsv.h, s, v))
      }} onBlur={end} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pickField(event) }} onPointerMove={event => { if (event.buttons) pickField(event) }} onPointerUp={end} style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}>
        <span className="custom-color__field-marker" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
      </div>
      <div className="custom-color__hue-wrap"><input aria-label="Hue" type="range" min="0" max="359" value={Math.round(hsv.h)} onPointerDown={begin} onPointerUp={end} onBlur={end} onChange={event => setHue(Number(event.target.value))} style={{ '--hue-position': `${(hsv.h / 359) * 100}%` } as React.CSSProperties} /></div>
      <div className="custom-color__value-heading"><span>Color values</span><div className="custom-color__segmented" role="group" aria-label="Color value format">{(['HEX', 'RGB'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? 'is-active' : ''} onClick={() => { setMode(value); setHexDraft(color); setRgbDraft(null) }}>{value}</button>)}</div></div>
      {mode === 'HEX' ? <div className="custom-color__hex-row"><span className="custom-color__sample" style={{ backgroundColor: color }} /><input aria-label="HEX" value={hexDraft} maxLength={7} onFocus={begin} onChange={event => { const value = event.target.value; setHexDraft(value); const valid = parseHex(value); if (valid) apply(valid, 'hex') }} onBlur={() => { if (!parseHex(hexDraft)) setHexDraft(color); end() }} onKeyDown={event => { if (event.key === 'Enter') { const valid = parseHex(hexDraft); if (valid) { apply(valid, 'hex'); setHexDraft(valid) }; event.currentTarget.blur() } }} /><button type="button" aria-label="Copy color" onClick={copy}><Clipboard size={15}/><span>{copied ? 'Copied' : 'Copy'}</span></button></div> : <div className="custom-color__rgb-row">{(['r','g','b'] as const).map((channel, index) => <label key={channel}>{channel.toUpperCase()}<input aria-label={channel.toUpperCase()} type="text" inputMode="numeric" aria-invalid={!!rgbDraft?.[channel] && Number(rgbDraft[channel]) > 255} value={rgbDraft?.[channel] ?? String(rgb[channel])} onFocus={begin} onChange={event => {
        const value = event.target.value
        if (!/^\d{0,3}$/.test(value)) return
        const draft = { ...(rgbDraft ?? { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) }), [channel]: value }
        setRgbDraft(draft)
        if (value !== '' && Number(value) <= 255) apply(rgbToHex({ r: Number(draft.r || rgb.r), g: Number(draft.g || rgb.g), b: Number(draft.b || rgb.b) }), 'rgb')
      }} onBlur={event => { const value = event.currentTarget.value; if (value === '' || Number(value) > 255) setRgbDraft(null); end() }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />{index < 2 && <span className="sr-only">,</span>}</label>)}</div>}
      <section className="custom-color__palette" aria-label={`My Palette ${palette.length} / 16`}>
        <header><h3>My Palette</h3><span>{palette.length} / 16</span></header>
        {palette.length === 0 ? <div className="custom-color__empty"><p>No saved colors yet.</p><span>Save your favorite frame colors here.</span><button type="button" className="custom-color__save" disabled={palette.length >= 16} onClick={saveCurrent}><Plus size={15}/>Save current color</button></div> : <>
          <div className="custom-color__swatches">{palette.map(saved => <button key={saved} type="button" className={`custom-color__palette-swatch ${saved === color ? 'is-selected' : ''}`} aria-label={`Apply ${saved}`} aria-pressed={saved === color} title={`${saved} · right-click to edit or remove`} style={{ backgroundColor: saved }} onClick={() => { begin(); apply(saved); end() }} onContextMenu={event => { event.preventDefault(); editSaved(saved) }} onKeyDown={event => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSaved(saved) } if (event.key === 'F2') { event.preventDefault(); editSaved(saved) } }} />)}{palette.length < 16 && <button type="button" className="custom-color__add" aria-label="Add color to My Palette" title="Save current color" disabled={palette.includes(color)} onClick={saveCurrent}><Plus size={17}/></button>}</div>
          <div className="custom-color__palette-actions"><button type="button" disabled={!palette.includes(color)} onClick={() => editSaved(color)}>Edit selected color</button><button type="button" disabled={!palette.includes(color)} onClick={() => removeSaved(color)}>Remove</button></div>
        </>}
        {palette.length >= 16 && <p className="custom-color__limit">Palette full. Edit or remove a saved color to add another.</p>}
      </section>
    </div>, document.body)}
  </>
}
