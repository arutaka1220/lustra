import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PointerEvent } from 'react'
import { fitCropRatio, FULL_CROP, moveCrop, ratioValue, resizeCrop, validCrop } from './crop-model'
import type { CropRect } from './crop-model'

type Props = { bounds: { x: number; y: number; width: number; height: number }; crop?: CropRect; sourceWidth: number; sourceHeight: number; source: CanvasImageSource; onChange: (crop: CropRect) => void }
type Drag = { handle: string; x: number; y: number; crop: CropRect; angle: number }

export function CropOverlay({ bounds, crop: stored, sourceWidth, sourceHeight, source, onChange }: Props) {
  const { t } = useTranslation()
  const [presets, setPresets] = useState<Record<string, CropRect>>(() => { try { return JSON.parse(localStorage.getItem('lustra.crop-presets.v1') ?? '{}') as Record<string, CropRect> } catch { return {} } })
  const [presetName, setPresetName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')
  const crop = { ...FULL_CROP, rotation: 0, ratio: 'original' as const, locked: true, ...stored, ...validCrop(stored) }
  const drag = useRef<Drag | undefined>(undefined)
  const result = useRef<HTMLCanvasElement>(null)
  const [active, setActive] = useState(false)
  useEffect(() => () => { delete document.documentElement.dataset.lustraPreviewDrag }, [])
  const point = (event: PointerEvent<SVGElement>) => {
    const rect = event.currentTarget.closest('svg')!.getBoundingClientRect()
    return { x: (event.clientX - rect.left - bounds.x) / bounds.width, y: (event.clientY - rect.top - bounds.y) / bounds.height }
  }
  const start = (event: PointerEvent<SVGElement>, handle: string) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.closest('svg')!.setPointerCapture(event.pointerId); document.documentElement.dataset.lustraPreviewDrag = '1'
    const p = point(event); drag.current = { handle, ...p, crop, angle: Math.atan2(p.y - .5, p.x - .5) }; setActive(true)
  }
  const update = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    const p = point(event), d = drag.current
    if (d.handle === 'rotate') {
      let delta = (Math.atan2(p.y - .5, p.x - .5) - d.angle) * 180 / Math.PI
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      onChange({ ...d.crop, rotation: (d.crop.rotation ?? 0) + delta })
      return
    }
    const dx = (p.x - d.x), dy = (p.y - d.y)
    const ratio = d.crop.locked === false ? undefined : ratioValue(d.crop.ratio ?? 'original', sourceWidth, sourceHeight, d.crop.customRatio) ?? d.crop.width * sourceWidth / (d.crop.height * sourceHeight)
    onChange(d.handle === 'move' ? moveCrop(d.crop, dx, dy) : resizeCrop(d.crop, d.handle, dx, dy, ratio ? ratio * sourceHeight / sourceWidth : undefined))
  }
  const end = () => { if (!drag.current) return; drag.current = undefined; delete document.documentElement.dataset.lustraPreviewDrag; setActive(false) }
  const x = bounds.x + crop.x * bounds.width, y = bounds.y + crop.y * bounds.height
  const w = crop.width * bounds.width, h = crop.height * bounds.height
  useLayoutEffect(() => {
    const canvas = result.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(w * pixelRatio)); canvas.height = Math.max(1, Math.round(h * pixelRatio))
    const angle = ((crop.rotation ?? 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle))
    const scale = Math.max(canvas.width / (canvas.width * c + canvas.height * s), canvas.height / (canvas.height * c + canvas.width * s))
    context.imageSmoothingQuality = 'high'
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle); context.scale(scale, scale)
    context.drawImage(source, crop.x * sourceWidth, crop.y * sourceHeight, crop.width * sourceWidth, crop.height * sourceHeight, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height)
  }, [source, sourceWidth, sourceHeight, crop.x, crop.y, crop.width, crop.height, crop.rotation, w, h])
  const handles = [
    ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2],
    ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2],
  ] as const
  const savePresets = (next: Record<string, CropRect>) => { setPresets(next); try { localStorage.setItem('lustra.crop-presets.v1', JSON.stringify(next)) } catch { /* Storage may be unavailable in private contexts. */ } }
  const startFromSurface = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    const p = point(event)
    const nearCorner = [[crop.x,crop.y],[crop.x+crop.width,crop.y],[crop.x,crop.y+crop.height],[crop.x+crop.width,crop.y+crop.height]].some(([cx,cy]) => Math.hypot((p.x-cx)*bounds.width/bounds.height,p.y-cy) < .16)
    if (p.x >= crop.x && p.x <= crop.x+crop.width && p.y >= crop.y && p.y <= crop.y+crop.height) start(event, 'move')
    else if (nearCorner) start(event, 'rotate')
  }
  return <div className="crop-overlay-wrap"><canvas ref={result} className="crop-result-preview" style={{ left: x, top: y, width: w, height: h }} aria-hidden="true"/><svg className={`crop-overlay${active ? ' is-dragging' : ''}`} aria-label="Crop controls" onPointerDown={startFromSurface} onPointerMove={update} onPointerUp={end} onPointerCancel={end}>
    <defs><mask id="crop-mask"><rect width="100%" height="100%" fill="white"/><rect x={x} y={y} width={w} height={h} fill="black"/></mask></defs>
    <rect width="100%" height="100%" fill="rgba(0,0,0,.52)" mask="url(#crop-mask)" pointerEvents="none" />
    <rect x={x} y={y} width={w} height={h} className="crop-outline" onPointerDown={e => start(e, 'move')} />
    <path d={`M${x + w / 3} ${y}V${y+h} M${x+2*w/3} ${y}V${y+h} M${x} ${y+h/3}H${x+w} M${x} ${y+2*h/3}H${x+w}`} className="crop-grid" pointerEvents="none"/>
    {[[x - 24,y - 24],[x + w + 24,y - 24],[x - 24,y + h + 24],[x + w + 24,y + h + 24]].map(([cx,cy],i) => <circle key={`rotate-${i}`} cx={cx} cy={cy} r="15" className="crop-rotate-hit" onPointerDown={e => start(e,'rotate')} />)}
    {handles.map(([name, cx, cy]) => <circle key={name} cx={cx} cy={cy} r="9" className={`crop-handle crop-handle--${name}`} onPointerDown={e => start(e, name)} />)}
  </svg><div className="crop-settings" onPointerDown={event => event.stopPropagation()}>
    <label>{t('crop.ratio')}<select aria-label={t('crop.ratio')} value={crop.ratio ?? 'original'} onChange={event => { const ratio = event.target.value as NonNullable<CropRect['ratio']>; const next = { ...crop, ratio }; const value = ratioValue(ratio, sourceWidth, sourceHeight, crop.customRatio); onChange(value ? fitCropRatio(next, sourceWidth, sourceHeight, value) : next) }}>
      {['original','free','1:1','3:2','4:3','16:9','9:16','custom'].map(value => <option key={value}>{value}</option>)}
    </select></label><label className="crop-lock"><input type="checkbox" aria-label={t('crop.lock')} checked={crop.locked !== false} onChange={event => onChange({ ...crop, locked: event.target.checked })}/>{t('crop.lock')}</label>
    {crop.ratio === 'custom' && <input aria-label="Custom crop ratio" type="number" min="0.01" step="0.01" value={crop.customRatio ?? sourceWidth / sourceHeight} onChange={event => { const customRatio = Number(event.target.value); if (!Number.isFinite(customRatio) || customRatio <= 0) return; onChange({ ...fitCropRatio(crop, sourceWidth, sourceHeight, customRatio), ratio: 'custom', customRatio }) }} />}
    <label>{t('crop.rotation')} <input aria-label={t('crop.rotation')} aria-valuetext={`${(crop.rotation ?? 0).toFixed(2)}°`} type="number" min="-180" max="180" step="0.01" value={crop.rotation ?? 0} onChange={event => onChange({ ...crop, rotation: Number(event.target.value) || 0 })} /><span aria-hidden="true">°</span></label>
    <input aria-label={`${t('crop.rotation')} slider`} type="range" min="-180" max="180" step="0.01" value={crop.rotation ?? 0} onChange={event => onChange({ ...crop, rotation: Number(event.target.value) })}/>
    <button type="button" aria-label={t('crop.resetRotation')} onClick={() => onChange({ ...crop, rotation: 0 })}>↺</button>
    <input aria-label={t('crop.presetName')} value={presetName} onChange={event => setPresetName(event.target.value)} placeholder={t('crop.presetName')} />
    <button type="button" disabled={!presetName.trim()} onClick={() => { const name = presetName.trim(); savePresets({ ...presets, [name]: structuredClone(crop) }); setSelectedPreset(name) }}>{t('crop.save')}</button>
    <select aria-label={t('crop.presets')} value={selectedPreset} onChange={event => { const name = event.target.value; setSelectedPreset(name); if (presets[name]) { setPresetName(name); const preset = structuredClone(presets[name]); const ratio = ratioValue(preset.ratio ?? 'original', sourceWidth, sourceHeight, preset.customRatio); onChange(ratio ? fitCropRatio(preset, sourceWidth, sourceHeight, ratio) : preset) } }}><option value="">{t('crop.presets')}</option>{Object.keys(presets).map(name => <option key={name} value={name}>{name}</option>)}</select>
    <button type="button" disabled={!selectedPreset} onClick={() => savePresets({ ...presets, [selectedPreset]: structuredClone(crop) })}>{t('crop.update')}</button>
  </div></div>
}
