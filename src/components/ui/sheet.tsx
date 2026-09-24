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
        "anim-sheet bg-surface text-foreground m-0 max-h-none max-w-none p-0 shadow-2xl",
        // mobile: bottom sheet
        "top-auto right-0 bottom-0 left-0 max-h-[90dvh] w-full rounded-t-2xl",
        // desktop: panel lateral
        "md:top-0 md:right-0 md:bottom-0 md:left-auto md:h-dvh md:max-h-dvh md:w-[28rem] md:rounded-t-none md:rounded-l-2xl",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col md:h-dvh md:max-h-dvh">
          <div
            className="bg-input mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full md:hidden"
            aria-hidden
          />
          <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3 md:px-5 md:py-4">
            <div className="flex flex-col gap-0.5">
              <h2 id="sheet-title" className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="text-muted text-sm">{description}</p>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
            >
              <X />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
            {children}
          </div>
          {footer && (
            <footer className="pb-safe border-border bg-surface flex shrink-0 gap-2 border-t px-4 pt-3 md:justify-end md:px-5 md:pb-4 [&>*]:flex-1 md:[&>*]:flex-none">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
