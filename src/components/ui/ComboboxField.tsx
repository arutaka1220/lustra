import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './combobox-field.css'

type ComboboxFieldProps = {
  label: string
  value: string
  options: readonly string[]
  placeholder?: string
  onValueChange: (value: string) => void
}

export function ComboboxField({ label, value, options, placeholder, onValueChange }: ComboboxFieldProps) {
  const inputId = useId()
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [popup, setPopup] = useState<{ top: number; left: number; width: number; maxHeight: number }>()
  const filtered = useMemo(() => {
    const query = draft.trim().toLocaleLowerCase()
    return options.filter((option) => !query || option.toLocaleLowerCase().includes(query)).slice(0, 12)
  }, [draft, options])

  useEffect(() => setDraft(value), [value])
  useLayoutEffect(() => {
    if (!open || !input.current) return
    const placePopup = () => {
      const bounds = input.current?.getBoundingClientRect()
      if (!bounds) return
      const maxHeight = Math.min(280, window.innerHeight - 24)
      const below = window.innerHeight - bounds.bottom - 12
      const top = below >= Math.min(maxHeight, 190)
        ? bounds.bottom + 4
        : Math.max(8, bounds.top - Math.min(maxHeight, 12 * 34 + 10) - 4)
      setPopup({ top, left: bounds.left, width: bounds.width, maxHeight })
    }
    placePopup()
    window.addEventListener('resize', placePopup)
    window.addEventListener('scroll', placePopup, true)
    return () => {
      window.removeEventListener('resize', placePopup)
      window.removeEventListener('scroll', placePopup, true)
    }
  }, [open])

  function commit(next: string) {
    const normalized = next.trim()
    const finalValue = normalized || value
    setDraft(finalValue)
    setOpen(false)
    if (finalValue !== value) onValueChange(finalValue)
  }

  const popupContent = open && popup && filtered.length > 0 ? createPortal(
    <div className="ui-combobox-popup" style={popup}>
      <div className="ui-combobox-list" role="listbox" id={listId} aria-label={label}>
        {filtered.map((option, index) => (
          <div
            id={`${listId}-option-${index}`}
            className="ui-combobox-option"
            role="option"
            aria-selected={option === value}
            data-highlighted={index === activeIndex || undefined}
            key={option}
            onPointerDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => commit(option)}
          >{option}</div>
        ))}
      </div>
    </div>,
    document.body,
  ) : null

  return <>
    <div className="ui-combobox-field">
      <label htmlFor={inputId}>{label}</label>
      <input
      ref={input}
      id={inputId}
      className="text-field ui-combobox-input"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open && filtered.length > 0}
      aria-controls={listId}
      aria-activedescendant={open && filtered.length ? `${listId}-option-${activeIndex}` : undefined}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onFocus={() => { setOpen(true); setActiveIndex(0) }}
      onChange={(event) => { setDraft(event.target.value); setOpen(true); setActiveIndex(0) }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && filtered.length) {
          event.preventDefault()
          setOpen(true)
          setActiveIndex((current) => Math.min(filtered.length - 1, current + 1))
        } else if (event.key === 'ArrowUp' && filtered.length) {
          event.preventDefault()
          setOpen(true)
          setActiveIndex((current) => Math.max(0, current - 1))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          commit(open && filtered[activeIndex] ? filtered[activeIndex] : draft)
        } else if (event.key === 'Escape') {
          setDraft(value)
          setOpen(false)
        }
      }}
      />
    </div>
    {popupContent}
  </>
}
