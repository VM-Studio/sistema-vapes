"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
}

/** Opción de radio nativa (el grupo lo arma quien la usa, con el mismo `name`). */
export function Radio({ label, hint, id, className, ...props }: RadioProps) {
  const autoId = useId();
  const radioId = id ?? autoId;
  return (
    <label
      htmlFor={radioId}
      className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2.5", className)}
    >
      <input
        id={radioId}
        type="radio"
        className="mt-0.5 size-[1.125rem] shrink-0 cursor-pointer accent-[#0a0a0a]"
        {...props}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-subtle text-small">{hint}</span>}
      </span>
    </label>
  );
}
