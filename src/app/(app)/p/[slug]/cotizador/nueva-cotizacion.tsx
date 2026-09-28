import { Modulo } from "@prisma/client";

import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";

import { EditorCotizacion, type TipoCotizacionUI } from "./editor-cotizacion";

/** Página "nueva cotización" (unitaria o mayorista): el editor vacío con la config del panel. */
export async function NuevaCotizacion({ tipo }: { tipo: TipoCotizacionUI }) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "crear");
  const config = await obtenerConfigCotizacion(ctx);
  return (
    <EditorCotizacion
      tipo={tipo}
      inicial={null}
      validezDefault={config.validezDias}
      modoEscalon={config.modoEscalonMayorista}
      mostrarStock={config.mostrarStock}
      puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "editar")}
      esOwner={esOwner(ctx.usuario)}
      puedeVender={puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear")}
    />
  );
}
