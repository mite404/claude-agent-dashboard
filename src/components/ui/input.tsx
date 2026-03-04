import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-(--radius) border border-stone-700 bg-transparent px-3 py-1',
        'text-sm text-stone-100 placeholder:text-stone-500',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
