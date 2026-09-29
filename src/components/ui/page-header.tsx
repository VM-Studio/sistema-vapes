import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Botones de acción: a la derecha en desktop; debajo del título, a lo ancho, en mobile. */
  actions?: ReactNode;
  /** Migas de pan (<Breadcrumb>) arriba del título. */
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 md:mb-8", className)}>
      {breadcrumb}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 font-semibold">{title}</h1>
          {subtitle && <p className="text-muted text-body">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2 md:flex-nowrap [&>*]:flex-1 md:[&>*]:flex-none">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
