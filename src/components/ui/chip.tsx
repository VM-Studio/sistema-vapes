import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const base =
  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4";

/** Filtro rápido (link): activo = relleno con el primario. */
export function ChipLink({
  href,
  activo,
  children,
  className,
}: {
  href: string;
  activo: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={activo ? "true" : undefined}
      className={cn(
        base,
        activo
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-surface text-foreground hover:border-input hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Fila de chips con scroll horizontal en mobile. */
export function ChipRow({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
