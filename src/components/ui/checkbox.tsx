"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function Checkbox({ label, hint, error, id, className, ...props }: CheckboxProps) {
  const autoId = useId();
  const checkboxId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          className="border-input size-[1.125rem] shrink-0 cursor-pointer rounded-inner accent-foreground"
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {label && <span className="text-foreground text-sm">{label}</span>}
      </label>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted pl-8 text-sm">{hint}</p>
      ) : null}
    </div>
  );
}
