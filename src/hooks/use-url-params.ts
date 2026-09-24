"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Estado de filtros en la URL (compartible y sobrevive al refresh).
 * `actualizar({ q: "mango", page: null })`: null/"" borra el parámetro.
 * Cambiar cualquier filtro vuelve a la página 1, salvo que se pase `page`.
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pendiente, startTransition] = useTransition();

  const actualizar = useCallback(
    (cambios: Record<string, string | number | boolean | null | undefined>) => {
      const nuevos = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v === null || v === undefined || v === "" || v === false) nuevos.delete(k);
        else nuevos.set(k, String(v === true ? "1" : v));
      }
      if (!("page" in cambios)) nuevos.delete("page");
      const qs = nuevos.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  return { params, actualizar, pendiente };
}
