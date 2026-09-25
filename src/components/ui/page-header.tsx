import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Botones de acción: en mobile quedan debajo del título, a lo ancho. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="text-muted text-sm">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 md:flex-nowrap [&>*]:flex-1 md:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </div>
  );
}
