import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-(--radius) text-sm font-medium',
    'transition-colors select-none',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500',
    'disabled:pointer-events-none disabled:opacity-40',
    'cursor-pointer',
  ].join(' '),
  {
    variants: {
      variant: {
        default:     'bg-stone-100 text-stone-900 hover:bg-stone-200',
        secondary:   'bg-stone-800 text-stone-200 hover:bg-stone-700',
        destructive: 'bg-red-950/50 text-red-400 border border-red-900/50 hover:bg-red-900/50',
        warning:     'bg-amber-950/50 text-amber-400 border border-amber-900/50 hover:bg-amber-900/50',
        ghost:       'text-stone-400 hover:bg-stone-800 hover:text-stone-100',
        outline:     'border border-stone-700 text-stone-300 bg-transparent hover:bg-stone-800 hover:text-stone-100',
        link:        'text-stone-300 underline-offset-4 hover:underline',
      },
      size: {
        sm:   'h-7 px-2.5 text-xs',
        md:   'h-8 px-3',
        lg:   'h-9 px-4',
        icon: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'sm',
    },
  },
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
