import Link from "next/link";

import { cn } from "@/lib/utils";

export interface TabNavItem {
  href: string;
  label: string;
  activo: boolean;
  badge?: number | string;
}

/** Pestañas por URL (cada una es un link: compartible, funciona con back). Scroll horizontal en mobile. */
export function TabsNav({
  items,
  className,
  ariaLabel = "Secciones",
}: {
  items: TabNavItem[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}
    >
      <ul className="border-border flex min-w-max gap-2 border-b">
        {items.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.activo ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-12 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                t.activo
                  ? "border-accent text-foreground"
                  : "text-muted hover:text-foreground hover:border-input border-transparent",
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs leading-none tabular-nums",
                    t.activo ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
