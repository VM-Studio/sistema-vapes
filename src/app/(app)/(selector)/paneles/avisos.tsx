"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { CLAVE_ULTIMO_PANEL } from "@/lib/paneles";

/**
 * - ?aviso=sin-acceso (lo manda el middleware): toast "No tenés acceso a ese panel".
 * - ?origen=pwa (start_url de la app instalada): abre directo el último panel usado.
 */
export function AvisosPaneles({ slugs }: { slugs: string[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const hecho = useRef(false);

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;
    if (params.get("aviso") === "sin-acceso") {
      toast.error("No tenés acceso a ese panel", "Elegí uno de tus sistemas.");
      router.replace("/paneles");
      return;
    }
    if (params.get("origen") === "pwa") {
      let ultimo: string | null = null;
      try {
        ultimo = localStorage.getItem(CLAVE_ULTIMO_PANEL);
      } catch {
        /* almacenamiento bloqueado */
      }
      router.replace(ultimo && slugs.includes(ultimo) ? `/p/${ultimo}` : "/paneles");
    }
  }, [params, router, slugs, toast]);

  return null;
}
