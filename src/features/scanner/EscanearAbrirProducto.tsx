"use client";

import { Modulo } from "@prisma/client";
import { useRouter } from "next/navigation";

import { useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { useUrlParams } from "@/hooks/use-url-params";

import { BotonCamara } from "./BotonCamara";
import { useEscanerVariantes } from "./useEscanerVariantes";

/**
 * En listados del panel (productos, stock): escanear un código (pistola o cámara)
 * busca exacto y abre la ficha del producto. Sin permiso para ver productos,
 * filtra el listado por el SKU de la variante.
 */
export function EscanearAbrirProducto() {
  const router = useRouter();
  const { actualizar } = useUrlParams();
  const ruta = useRutaPanel();
  const puedeVerProductos = usePuede(Modulo.PRODUCTOS, "ver");
  const escaner = useEscanerVariantes({
    onVariante: (v) => {
      if (!puedeVerProductos) return actualizar({ q: v.codigoBarras ?? v.sku });
      const destino = ruta(`/productos/${v.productoId}`);
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
