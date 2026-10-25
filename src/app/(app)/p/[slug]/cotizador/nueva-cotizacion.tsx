import { Modulo } from "@prisma/client";

import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanel } from "@/server/auth/permissions";
import { obtenerCotizacion } from "@/server/services/cambio.service";
import { obtenerConfigCotizacion } from "@/server/services/configuracion.service";

import { EditorCotizacion, type TipoCotizacionUI } from "./editor-cotizacion";

/**
 * Página "nueva cotización" (unitaria o mayorista): el editor vacío con la config del panel.
 * Sin «Cotizar a precio Mercado Libre»: el precio ML ya no se guarda en el producto
 * (las ventas por ML llevan el precio a mano); solo lo ven las cotizaciones viejas que lo usaban.
 */
export async function NuevaCotizacion({ tipo }: { tipo: TipoCotizacionUI }) {
  const ctx = await requirePaginaPanel(Modulo.COTIZADOR, "crear");
  const [config, blue] = await Promise.all([
    obtenerConfigCotizacion(ctx),
    tipo === "MAYORISTA" ? obtenerCotizacion("USD_BLUE", "VENTA") : Promise.resolve(null),
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
    />
  );
}
