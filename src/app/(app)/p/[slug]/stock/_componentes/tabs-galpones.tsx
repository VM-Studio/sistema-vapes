import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Pestañas de galpón (por URL) como botones rectangulares: la activa en negro.
 * Es un <nav> "Galpones" con links (aria-current="page" en la activa), con
 * scroll horizontal en mobile.
 */
export function TabsGalpones({
  items,
  className,
}: {
  items: { href: string; label: string; activo: boolean }[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Galpones"
      className={cn("-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0", className)}
    >
      <ul className="flex min-w-max gap-2">
        {items.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.activo ? "page" : undefined}
              className={cn(
                "rounded-control flex h-11 items-center border px-4 text-sm font-medium whitespace-nowrap transition-colors md:h-10",
                t.activo
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-surface text-muted hover:border-input hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
