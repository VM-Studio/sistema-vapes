"use client";

import { ChevronDown } from "lucide-react";
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

import { controlClass, describedBy, Field } from "./field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
  ref?: React.Ref<HTMLSelectElement>;
}

/** Select nativo: en mobile abre el selector del sistema (el más cómodo con una mano). */
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  id,
  className,
  containerClassName,
  required,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <select
          id={selectId}
          className={cn(controlClass, "h-12 appearance-none pr-10 md:h-11", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(selectId, error, hint)}
          required={required}
          {...props}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="text-muted pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
    </Field>
  );
}
