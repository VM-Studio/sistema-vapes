import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Tarjeta: gris clarito, sin borde ni sombra en reposo, radio 10px.
 * - `default` / `flat`: superficie gris (flat sin padding interno propio: es igual, alias explícito).
 * - `kpi`: métrica (padding y gap propios).
 * - `clickable`: hover con sombra sutil (usar sobre <a>/<button> o con onClick).
 * - `outline`: fondo blanco con borde fino (contenido que va DENTRO de otra tarjeta).
 */
export const cardVariants = cva("rounded-card text-foreground", {
  variants: {
    variant: {
      default: "bg-card",
      flat: "bg-card",
      kpi: "bg-card flex flex-col gap-1.5 p-5",
      clickable:
        "bg-card transition-[background-color,box-shadow] duration-150 hover:bg-card-hover hover:shadow-card-hover",
      outline: "border border-border bg-surface",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1 p-5 pb-0 md:p-6 md:pb-0", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-h3 font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-muted text-small", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 md:p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 border-t border-black/[0.06] px-5 py-4 md:px-6",
        className,
      )}
      {...props}
    />
  );
}
