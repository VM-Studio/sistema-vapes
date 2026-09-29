import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Tarjeta con título (y acción opcional a la derecha) + contenido. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("bg-card rounded-card", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-5 md:px-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-h3 font-semibold">{title}</h2>
          {description && <p className="text-muted text-small">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn("p-5 md:p-6", contentClassName)}>{children}</div>
    </section>
  );
}
