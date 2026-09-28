"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { useDialogElement } from "./use-dialog-element";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Barra inferior fija (botones de acción). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Panel deslizante: desde abajo en mobile (alcanzable con el pulgar),
 * lateral derecho en desktop.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: SheetProps) {
  const { ref, onBackdropClick } = useDialogElement(open, onOpenChange);

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby="sheet-title"
      className={cn(
        "anim-sheet bg-surface text-foreground shadow-sheet m-0 max-h-none max-w-none p-0",
        // mobile: bottom sheet
        "top-auto right-0 bottom-0 left-0 max-h-[90dvh] w-full rounded-t-3xl",
        // desktop: panel lateral
        "md:top-0 md:right-0 md:bottom-0 md:left-auto md:h-dvh md:max-h-dvh md:w-[30rem] md:rounded-t-none md:rounded-l-2xl",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col md:h-dvh md:max-h-dvh">
          <div
            className="bg-input mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full md:hidden"
            aria-hidden
          />
          <header className="border-border flex items-start justify-between gap-3 border-b px-5 py-4 md:px-6 md:py-5">
            <div className="flex min-w-0 flex-col gap-1 pt-1.5">
              <h2 id="sheet-title" className="text-xl leading-tight font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="text-muted text-sm">{description}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
              className="-mr-2 shrink-0"
            >
              <X strokeWidth={1.75} />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 md:px-6">
            {children}
          </div>
          {footer && (
            <footer className="pb-safe border-border bg-surface flex shrink-0 gap-3 border-t px-5 pt-4 md:justify-end md:px-6 md:pb-5 [&>*]:flex-1 md:[&>*]:flex-none">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
