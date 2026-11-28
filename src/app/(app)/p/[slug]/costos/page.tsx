import type { Metadata } from "next";

import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { listarCostos } from "@/server/services/costos.service";

import { CostosView } from "./costos-view";

export const metadata: Metadata = { title: "Costos" };

/**
 * «Costos» (solo dueños): todos los productos del panel juntos con lo que
 * cuesta cada uno por unidad (costo final de la última compra recibida o el
 * cargado con el stock), para repasarlos.
 */
export default async function CostosPage() {
  const ctx = await requirePaginaPanelOwner();
  const { productos, cotizacion } = await listarCostos(ctx);
  return (
    <CostosView
      productos={productos}
      cotizacion={cotizacion}
      etiquetaEspecificacion={ctx.panel.etiquetaEspecificacion}
    />
  );
}
