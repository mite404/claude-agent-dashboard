import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-white/10 text-white hover:bg-white/20',
        destructive: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
        warning: 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30',
        ghost: 'text-white/50 hover:bg-white/10 hover:text-white',
        outline: 'border border-white/10 text-white/70 hover:bg-white/10',
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-3',
        lg: 'h-8 px-4',
        icon: 'h-6 w-6 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
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
