import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Estado vacío: ícono grande en gris (sin ilustraciones genéricas), título
 * claro y la acción principal. Sobre la tarjeta del sistema, con el osito
 * como marca de agua muy tenue en la esquina.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "bg-card rounded-card relative isolate flex flex-col items-center justify-center gap-5 overflow-hidden px-6 py-14 text-center md:py-20",
        className,
      )}
    >
      <div
        aria-hidden
        className="marca-agua text-marca-azul absolute -right-10 -bottom-10 -z-10 size-48 opacity-[0.06]"
      />
      {Icon && <Icon className="text-subtle/70 size-14" strokeWidth={1.25} aria-hidden />}
      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="text-h3 font-semibold">{title}</p>
        {description && <p className="text-muted text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
