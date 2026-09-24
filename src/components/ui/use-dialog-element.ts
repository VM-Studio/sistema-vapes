"use client";

import { useEffect, useRef } from "react";

/**
 * Sincroniza un <dialog> nativo con `open`. El <dialog> modal trae gratis:
 * foco atrapado, Escape, fondo inerte y top-layer (sin z-index ni portales).
 */
export function useDialogElement(open: boolean, onOpenChange: (open: boolean) => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape: lo controlamos nosotros para mantener `open` como fuente de verdad.
    const onCancel = (e: Event) => {
      e.preventDefault();
      onOpenChange(false);
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onOpenChange]);

  /** Click en el backdrop (fuera del contenido) cierra. */
  const onBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onOpenChange(false);
  };

  return { ref, onBackdropClick };
}
