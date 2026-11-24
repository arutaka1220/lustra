import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { ResetButton } from './ResetButton'

type InspectorSectionProps = {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
  onReset?: () => void
  resetDisabled?: boolean
}

export function InspectorSection({ title, open, onToggle, children, onReset, resetDisabled }: InspectorSectionProps) {
  const contentId = useId()

  return (
    <section className={`inspector-section ${open ? 'is-open' : ''}`}>
      <h2 className="inspector-section__heading">
        <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
          <span>{title}</span><ChevronDown size={15} aria-hidden="true" />
        </button>
        {onReset && <ResetButton label={title} onReset={onReset} disabled={resetDisabled} />}
      </h2>
      {open && <div className="inspector-section__content" id={contentId}>{children}</div>}
    </section>
  )
}
