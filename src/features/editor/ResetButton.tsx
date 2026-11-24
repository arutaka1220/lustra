import { useEffect, useRef } from 'react'
import { useResetModifier } from '../../hooks/useResetModifier'

type Props = { label: string; onReset: () => void; disabled?: boolean }

export function ResetButton({ label, onReset, disabled = false }: Props) {
  const modifierPressed = useResetModifier()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { if ((!modifierPressed || disabled) && button.current && button.current === document.activeElement) button.current.blur() }, [modifierPressed, disabled])
  return <button ref={button} type="button" className={`text-button contextual-reset${modifierPressed && !disabled ? ' is-available' : ''}`} aria-label={`Reset ${label}`}
    tabIndex={modifierPressed && !disabled ? 0 : -1} aria-hidden={!modifierPressed || disabled}
    disabled={!modifierPressed || disabled} onClick={event => { event.stopPropagation(); onReset() }}>Reset</button>
}
