import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Migas de pan: el último ítem es la página actual (sin link). */
export function Breadcrumb({
  items,
  className,
}: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Ubicación" className={cn("text-small", className)}>
      <ol className="text-subtle flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const ultimo = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !ultimo ? (
                <Link href={item.href} className="hover:text-foreground transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(ultimo && "text-muted")}
                  aria-current={ultimo ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!ultimo && <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
