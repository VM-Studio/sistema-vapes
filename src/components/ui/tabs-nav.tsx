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
      <ul className="border-border flex min-w-max gap-1 border-b">
        {items.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.activo ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                t.activo
                  ? "border-primary text-foreground"
                  : "text-muted hover:text-foreground border-transparent",
              )}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className="bg-surface-2 text-muted rounded-full px-1.5 text-xs tabular-nums">
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
