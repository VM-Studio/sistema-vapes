import { Modulo } from "@prisma/client";
import type { Metadata } from "next";

import { puede } from "@/lib/permisos";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { listarVariantesParaEtiquetas } from "@/server/services/etiquetas.service";
import { obtenerVariantesPorId } from "@/server/services/producto.service";

import { EtiquetasView } from "./etiquetas-view";

export const metadata: Metadata = { title: "Etiquetas" };

type SP = Record<string, string | string[] | undefined>;
const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

/** ?q=texto · ?producto=id (todas las de ese producto) · ?sinCodigo=1 (sin código de fábrica) · ?variantes=id,id (preseleccionadas). */
export default async function EtiquetasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const usuario = await requirePaginaPermiso(Modulo.PRODUCTOS, "ver");
  const params = await searchParams;
  const q = texto(params.q);
  const productoId = texto(params.producto);
  const soloSinCodigoDeFabrica = texto(params.sinCodigo) === "1";
  const hayFiltro = Boolean(q || productoId || soloSinCodigoDeFabrica);
  const variantes = hayFiltro
    ? await listarVariantesParaEtiquetas({
        q: q || undefined,
        productoId: productoId || undefined,
        soloSinCodigoDeFabrica,
      })
    : [];
  const idsIniciales = texto(params.variantes).split(",").filter(Boolean).slice(0, 300);
  const preseleccion = (await obtenerVariantesPorId(idsIniciales)).map((v) => ({
    varianteId: v.id,
    nombreCompleto: v.nombreCompleto,
    codigoBarras: v.codigoBarras,
  }));

  return (
    <EtiquetasView
      variantes={variantes}
      hayFiltro={hayFiltro}
      filtros={{ q, productoId, soloSinCodigoDeFabrica }}
      preseleccion={preseleccion}
      puedeGenerarCodigos={puede(usuario, Modulo.PRODUCTOS, "editar")}
    />
  );
}
