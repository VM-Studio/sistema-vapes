"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { controlClass, describedBy, Field } from "./field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  required,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <input
        id={inputId}
        className={cn(controlClass, "h-12 md:h-11", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
        required={required}
        {...props}
      />
    </Field>
  );
}
