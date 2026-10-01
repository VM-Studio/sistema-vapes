"use client";

import { X } from "lucide-react";
import { useId, type ReactNode } from "react";

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
  // Id único por instancia: con varios diálogos en la página, un id fijo apuntaría al título de otro.
  const idTitulo = useId();

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby={idTitulo}
      className={cn(
        "anim-sheet bg-card text-foreground shadow-sheet m-0 max-h-none max-w-none p-0",
        // mobile: bottom sheet
        "rounded-t-card top-auto right-0 bottom-0 left-0 max-h-[90dvh] w-full",
        // desktop: panel lateral
        "md:top-0 md:right-0 md:bottom-0 md:left-auto md:h-dvh md:max-h-dvh md:w-[30rem] md:rounded-none",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col md:h-dvh md:max-h-dvh">
          <div
            className="bg-input rounded-circle mx-auto mt-2 h-1 w-9 shrink-0 md:hidden"
            aria-hidden
          />
          <header className="border-marca-azul/[0.08] flex items-start justify-between gap-3 border-b px-4 py-3 md:px-6 md:py-5">
            <div className="flex min-w-0 flex-col gap-1 pt-1.5">
              <h2 id={idTitulo} className="text-h2 font-semibold">
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
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
            {children}
          </div>
          {footer && (
            <footer
              // Aire abajo siempre (no solo la safe area: en desktop vale 0 y dejaba
              // los botones pegados al borde); en iPhone, además, la barra de inicio.
              className="bg-card border-marca-azul/[0.08] flex shrink-0 gap-3 border-t px-4 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:justify-end md:px-6 md:pt-5 md:pb-[calc(1.75rem+env(safe-area-inset-bottom))] [&>*]:flex-1 md:[&>*]:flex-none"
            >
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
