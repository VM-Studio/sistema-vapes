"use client";

import { usePathname } from "next/navigation";
import { useState, type MouseEvent } from "react";

/**
 * Ruta "efectiva" para marcar el ítem activo de la navegación: apenas se toca
 * un link, el menú ya lo muestra activo, sin esperar a que el servidor
 * responda y cambie el pathname. Cuando la navegación termina (o el pathname
 * cambia por otro lado) se vuelve a usar el pathname real.
 */
export function useRutaOptimista() {
  const pathname = usePathname();
  const [pendiente, setPendiente] = useState<{ desde: string; ruta: string } | null>(null);
  const ruta = pendiente && pendiente.desde === pathname ? pendiente.ruta : pathname;

  /** onClick del Link: ignora clics que abren otra pestaña o ventana. */
  function marcar(href: string) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      setPendiente({ desde: pathname, ruta: href.split("?")[0]! });
    };
  }

  return { ruta, marcar };
}
