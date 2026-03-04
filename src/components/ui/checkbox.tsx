import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { IconCheck, IconMinus } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface CheckboxProps extends Omit<CheckboxPrimitive.CheckboxProps, 'onChange'> {
  onChange?: () => void
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, onChange, onCheckedChange, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onChange ?? onCheckedChange}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-sm border border-stone-600 bg-transparent',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-state-checked:border-stone-200 data-state-checked:bg-stone-200',
        'data-state-indeterminate:border-stone-200 data-state-indeterminate:bg-stone-200',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-stone-900">
        {checked === 'indeterminate'
          ? <IconMinus size={10} stroke={3} />
          : <IconCheck size={10} stroke={3} />
        }
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
