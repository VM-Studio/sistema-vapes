import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[1.125rem] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        secondary:
          "border border-border bg-surface text-foreground hover:border-input hover:bg-surface-2 active:bg-surface-2",
        danger: "bg-danger text-danger-foreground hover:bg-danger-hover active:bg-danger-hover",
        ghost: "text-foreground hover:bg-surface-2 active:bg-surface-2",
      },
      size: {
        // md, lg e icon miden ≥44px: área táctil mínima recomendada (48px en mobile).
        sm: "h-10 px-3.5 text-sm [&_svg]:size-4",
        md: "h-12 px-5 text-[0.9375rem] md:h-11 md:text-sm",
        lg: "h-14 px-6 text-base md:h-12",
        icon: "size-12 md:size-11",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Muestra un spinner y deshabilita el botón. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  loading = false,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
}
