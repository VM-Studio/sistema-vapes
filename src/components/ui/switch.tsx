"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** Oculta el label visualmente (queda para lectores de pantalla). */
  labelOculto?: boolean;
}

/** Interruptor accesible (role="switch"). Toda la fila es táctil, con 44px de alto. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  error,
  disabled,
  id,
  name,
  className,
  labelOculto,
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={switchId}
        className={cn(
          "flex min-h-11 cursor-pointer items-center justify-between gap-3",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {label && (
          <span className={cn("text-sm font-medium", labelOculto && "sr-only")}>{label}</span>
        )}
        <button
          id={switchId}
          type="button"
          role="switch"
          name={name}
          aria-checked={checked}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={cn(
            "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 disabled:cursor-not-allowed",
            checked ? "bg-foreground" : "bg-input",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-white shadow-[0_1px_2px_rgb(10_10_10/0.2)] transition-transform duration-150",
              checked ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </label>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted text-sm">{hint}</p>
      ) : null}
    </div>
  );
}
