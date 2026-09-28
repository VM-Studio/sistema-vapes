import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface FieldProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error con los ids para aria-describedby. */
export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && (
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
          {required && (
            <span className="text-danger" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: ReactNode): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** Estilo común de inputs/selects/textareas. text-base en mobile evita el zoom de iOS. */
export const controlClass =
  "w-full rounded-xl border border-input bg-surface px-3.5 text-base text-foreground placeholder:text-muted transition-[border-color,box-shadow] duration-150 hover:border-muted/50 focus:border-primary focus:ring-4 focus:ring-ring/15 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70 aria-invalid:border-danger aria-invalid:focus:ring-danger/15 md:text-sm";
