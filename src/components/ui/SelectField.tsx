import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import './select-field.css'

export type SelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

type SelectFieldProps = {
  value?: string
  onValueChange: (value: string) => void
  options: readonly SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export function SelectField({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: SelectFieldProps) {
  return (
    <Select.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        id={id}
        className={`ui-select-trigger${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="ui-select-trigger__icon"><ChevronDown size={15} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="ui-select-content" position="popper" sideOffset={6} align="start" collisionPadding={8}>
          <Select.ScrollUpButton className="ui-select-scroll-button"><ChevronUp size={15} aria-hidden="true" /></Select.ScrollUpButton>
          <Select.Viewport className="ui-select-viewport">
            {options.map((option) => (
              <Select.Item className="ui-select-item" value={option.value} disabled={option.disabled} key={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="ui-select-item__indicator"><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="ui-select-scroll-button"><ChevronDown size={15} aria-hidden="true" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
