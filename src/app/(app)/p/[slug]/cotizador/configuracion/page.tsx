import type { Metadata } from "next";

import { requirePaginaPanelOwner } from "@/server/auth/permissions";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";
import { listarEscalonesDefault } from "@/server/services/escalon.service";

import { ConfigCotizadorForm } from "./config-cotizador-form";

export const metadata: Metadata = { title: "Configuración del cotizador" };

export default async function ConfigCotizadorPage() {
  const ctx = await requirePaginaPanelOwner();
  const [config, escalones] = await Promise.all([
    obtenerConfigCotizacion(ctx),
    listarEscalonesDefault(ctx),
  ]);
  return <ConfigCotizadorForm config={config} escalones={escalones} />;
}
