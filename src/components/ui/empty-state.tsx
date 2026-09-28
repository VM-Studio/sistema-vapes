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

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface-2/60 flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="bg-surface border-border text-muted flex size-12 items-center justify-center rounded-2xl border">
          <Icon className="size-6" strokeWidth={1.75} aria-hidden />
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold tracking-tight">{title}</p>
        {description && <p className="text-muted text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
