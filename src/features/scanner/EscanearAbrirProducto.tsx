"use client";

import { Modulo } from "@prisma/client";
import { useRouter } from "next/navigation";

import { usePuede } from "@/components/layout/usuario-context";
import { useUrlParams } from "@/hooks/use-url-params";

import { BotonCamara } from "./BotonCamara";
import { useEscanerVariantes } from "./useEscanerVariantes";

/**
 * En listados (/productos, /inventario): escanear un código (pistola o cámara)
 * busca exacto y abre la ficha del producto. Sin permiso para ver productos,
 * filtra el listado por el SKU de la variante.
 */
export function EscanearAbrirProducto() {
  const router = useRouter();
  const { actualizar } = useUrlParams();
  const puedeVerProductos = usePuede(Modulo.PRODUCTOS, "ver");
  const escaner = useEscanerVariantes({
    onVariante: (v) => {
      if (!puedeVerProductos) return actualizar({ q: v.sku });
      const destino = `/productos/${v.productoId}`;
      router.push(destino);
      // En producción el router a veces descarta esta navegación (carrera con el prefetch
      // de la misma ficha, que suele estar en el listado). Si no se movió, navegación completa.
      setTimeout(() => {
        if (location.pathname !== destino) location.assign(destino);
      }, 1500);
    },
    tituloCamara: "Escaneá para abrir el producto",
  });
  return (
    <>
      <BotonCamara onClick={escaner.abrirCamara} className="size-11 flex-none!" />
      {escaner.ui}
    </>
  );
}
