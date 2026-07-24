import * as React from 'react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SettingFieldProps = React.ComponentProps<typeof Input> & {
  label: string
  error?: string | null
  required?: boolean
}

const SettingField = React.forwardRef<HTMLInputElement, SettingFieldProps>(
  function SettingField({
    id,
    label,
    error,
    required = false,
    className,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    ...props
  }, ref) {
    const errorId = error && id ? `${id}-error` : undefined

    return (
      <div data-slot="setting-field" className="flex flex-col gap-1.5">
        <Label htmlFor={id}>
          {label}
          {required && <span className="text-[var(--color-error)]">*</span>}
        </Label>
        <Input
          {...props}
          ref={ref}
          id={id}
          className={cn(className)}
          required={required}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={errorId ?? ariaDescribedBy}
        />
        {error && (
          <p id={errorId} className="text-xs text-[var(--color-error)]">
            {error}
          </p>
        )}
      </div>
    )
  },
)

export { SettingField }
