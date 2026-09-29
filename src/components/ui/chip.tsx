import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const base =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4";

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
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-surface text-muted hover:border-input hover:text-foreground",
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

/** Filtro rápido (botón, estado local): mismo aspecto que ChipLink. */
export function FilterChip({
  activo,
  onClick,
  children,
  className,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        base,
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-surface text-muted hover:border-input hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
