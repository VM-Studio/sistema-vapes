"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { useDialogElement } from "./use-dialog-element";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Modal centrado (en mobile, anclado abajo para alcanzarlo con el pulgar). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const { ref, onBackdropClick } = useDialogElement(open, onOpenChange);
  // Id único por instancia: con varios diálogos en la página, un id fijo apuntaría al título de otro.
  const idTitulo = useId();
  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby={idTitulo}
      className={cn(
        "anim-dialog bg-card text-foreground shadow-sheet rounded-card m-auto w-[calc(100%-2rem)] max-w-md p-0",
        "mb-[calc(1rem+env(safe-area-inset-bottom))] md:mb-auto",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1.5">
            <h2 id={idTitulo} className="text-h2 font-semibold">
              {title}
            </h2>
            {description && <div className="text-muted text-sm">{description}</div>}
          </div>
          {children}
          {footer && (
            <div className="flex flex-col-reverse gap-3 pt-1 md:flex-row md:justify-end">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: botón rojo. */
  danger?: boolean;
  /** Puede ser async: el botón muestra loading hasta que termine. */
  onConfirm: () => void | Promise<void>;
}

/** Confirmación de acciones (dar de baja, resetear, etc.). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [cargando, setCargando] = useState(false);

  async function confirmar() {
    setCargando(true);
    try {
      await onConfirm();
    } finally {
      setCargando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !cargando && onOpenChange(o)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={cargando}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={confirmar} loading={cargando}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
