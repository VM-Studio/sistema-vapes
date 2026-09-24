"use client";

import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

import { controlClass, describedBy, Field } from "./field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  containerClassName?: string;
  ref?: React.Ref<HTMLTextAreaElement>;
}

export function Textarea({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  required,
  rows = 3,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  return (
    <Field
      id={textareaId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <textarea
        id={textareaId}
        rows={rows}
        className={cn(controlClass, "min-h-24 py-2.5", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(textareaId, error, hint)}
        required={required}
        {...props}
      />
    </Field>
  );
}
