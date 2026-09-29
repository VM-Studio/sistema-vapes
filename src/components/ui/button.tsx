import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 select-none disabled:pointer-events-none disabled:opacity-40 aria-busy:cursor-progress [&_svg]:size-[1.125rem] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primario: negro sobre blanco. Secundario: blanco con borde negro fino.
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        secondary:
          "border border-foreground bg-surface text-foreground hover:bg-surface-2 active:bg-surface-3",
        danger: "bg-danger text-danger-foreground hover:bg-danger-hover active:bg-danger-hover",
        ghost: "text-foreground hover:bg-surface-2 active:bg-surface-3",
      },
      size: {
        // md, lg e icon: 44px en mobile (área táctil mínima), 40px en desktop.
        sm: "h-9 px-3 text-small [&_svg]:size-4",
        md: "h-11 px-4 text-body md:h-10 md:text-sm",
        lg: "h-12 px-5 text-body md:h-11",
        icon: "size-11 md:size-10",
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
