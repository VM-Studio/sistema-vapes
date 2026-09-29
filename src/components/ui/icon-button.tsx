import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { buttonVariants } from "./button";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Obligatorio: el botón solo tiene ícono. */
  "aria-label": string;
  variant?: "ghost" | "secondary" | "primary";
  size?: "sm" | "md";
  children: ReactNode;
}

/** Botón cuadrado de solo ícono (44px mobile / 40px desktop; sm = 36px). */
export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        buttonVariants({ variant, size: "icon" }),
        variant === "ghost" && "text-muted hover:text-foreground",
        size === "sm" && "size-9 md:size-9 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
