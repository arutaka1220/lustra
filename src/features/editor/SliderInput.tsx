import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { ResetButton } from './ResetButton'

type SliderInputProps = {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  onChangeStart?: () => void
  onChangeEnd?: () => void
  onReset?: () => void
}

export function SliderInput({ label, value, min = 0, max = 40, step = 1, unit = '%', onChange, onChangeStart, onChangeEnd, onReset }: SliderInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const activePointer = useRef<number | null>(null)
  const endChangeRef = useRef(onChangeEnd)

  useEffect(() => { endChangeRef.current = onChangeEnd }, [onChangeEnd])
  useEffect(() => () => {
    if (activePointer.current !== null) endChangeRef.current?.()
  }, [])

  const stopSlide = (pointerId: number) => {
    if (activePointer.current !== pointerId) return
    activePointer.current = null
    onChangeEnd?.()
  }

  const commit = () => {
    if (draft?.trim()) {
      const next = Number(draft)
      if (Number.isFinite(next)) {
        const snapped = Math.round((next - min) / step) * step + min
        onChange(Math.min(max, Math.max(min, Number(snapped.toFixed(8)))))
      }
    }
    setDraft(null)
  }

  return (
    <div className="slider-field">
      <div className="slider-field__label-row"><span className="slider-field__label">{label}</span>{onReset && <ResetButton label={label} onReset={onReset} />}</div>
      <div className="slider-field__control">
        <Slider.Root className="slider-root" min={min} max={max} step={step} value={[value]} onValueChange={([next]) => next != null && onChange(next)}
          onPointerDownCapture={(event) => {
            if (event.button !== 0 || activePointer.current !== null) return
            activePointer.current = event.pointerId
            onChangeStart?.()
          }}
          onPointerUpCapture={(event) => stopSlide(event.pointerId)}
          onPointerCancelCapture={(event) => stopSlide(event.pointerId)}
          onLostPointerCapture={(event) => stopSlide(event.pointerId)}>
          <Slider.Track className="slider-track"><Slider.Range className="slider-range" /></Slider.Track>
          <Slider.Thumb className="slider-thumb" aria-label={label} />
        </Slider.Root>
        <div className="slider-number">
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? value}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setDraft(null)
            }}
          />
          <span>{unit}</span>
        </div>
      </div>
    </div>
  )
}
