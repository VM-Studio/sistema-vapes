import { Modulo } from "@prisma/client";

import { tieneMercadoLibre } from "@/lib/medios-pago";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerCotizacion } from "@/server/services/cambio.service";
import {
  obtenerConfigCotizacion,
  obtenerConfigVentas,
} from "@/server/services/configuracion.service";

import { EditorCotizacion, type TipoCotizacionUI } from "./editor-cotizacion";

/** Página "nueva cotización" (unitaria o mayorista): el editor vacío con la config del panel. */
export async function NuevaCotizacion({ tipo }: { tipo: TipoCotizacionUI }) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "crear");
  const [config, blue, configVentas] = await Promise.all([
    obtenerConfigCotizacion(ctx),
    tipo === "MAYORISTA" ? obtenerCotizacion("USD_BLUE", "VENTA") : Promise.resolve(null),
    obtenerConfigVentas(ctx),
  ]);
  return (
    <EditorCotizacion
      tipo={tipo}
      inicial={null}
      validezDefault={config.validezDias}
      blueInicial={blue ? { valor: blue.valor.toFixed(2), obtenidoAt: blue.obtenidoAt } : null}
      mostrarStock={config.mostrarStock}
      puedeEditar={puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "editar")}
      esOwner={esOwner(ctx.usuario)}
      puedeVender={puede(ctx.usuario, ctx.panelId, Modulo.VENTAS, "crear")}
      conMercadoLibre={tipo === "UNITARIA" && tieneMercadoLibre(configVentas)}
    />
  );
}
