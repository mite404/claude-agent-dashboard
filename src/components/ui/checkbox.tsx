import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<CheckboxPrimitive.CheckboxProps, "onChange"> {
  onChange?: () => void;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, onChange, onCheckedChange, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onChange ?? onCheckedChange}
      className={cn(
        "h-4 w-4 shrink-0 rounded-sm border-2 bg-transparent",
        "[border-color:var(--color-border-muted)]",
        "data-state-checked:[border-color:var(--color-text-secondary)] data-state-checked:[background-color:var(--color-text-secondary)]",
        "data-state-indeterminate:[border-color:var(--color-text-secondary)] data-state-indeterminate:[background-color:var(--color-text-secondary)]",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-stone-300">
        {checked === "indeterminate" ? (
          <IconMinus size={10} stroke={3} />
        ) : (
          <IconCheck size={10} stroke={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
