import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Tooltip liviano en CSS (hover y foco de teclado). Para textos cortos de
 * ayuda; no reemplaza un label: el disparador igual necesita aria-label.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "bg-foreground text-background pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 rounded-control px-2.5 py-1.5 text-xs leading-snug font-medium opacity-0 transition-opacity duration-100",
          "group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}
