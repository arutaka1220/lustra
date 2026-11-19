import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

type InspectorSectionProps = {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function InspectorSection({ title, open, onToggle, children }: InspectorSectionProps) {
  const contentId = useId()

  return (
    <section className={`inspector-section ${open ? 'is-open' : ''}`}>
      <h2 className="inspector-section__heading">
        <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
          <span>{title}</span><ChevronDown size={15} aria-hidden="true" />
        </button>
      </h2>
      {open && <div className="inspector-section__content" id={contentId}>{children}</div>}
    </section>
  )
}
