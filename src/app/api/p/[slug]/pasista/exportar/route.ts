import { Modulo } from "@prisma/client";

import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import { paramsComoObjeto, respuestaExcel } from "@/server/auth/descarga";
import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtx } from "@/server/auth/permissions";
import { exportarExcel, type CabeceraPanel } from "@/server/reportes/exportar";
import { nombreMes } from "@/server/reportes/filtros";
import { nombreNegocio } from "@/server/services/identidad.service";
import { listarMes, mesActualAR } from "@/server/services/pasista.service";

export const runtime = "nodejs";

/**
 * GET /api/p/{slug}/pasista/exportar?mes=YYYY-MM → Excel con las comisiones
 * del pasista del mes (una fila por compra y ajuste, con el total a pagar).
 * Permiso PASISTA "ver".
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireCtx(Modulo.PASISTA, "ver");
    const q = paramsComoObjeto(req.url);
    const mes = q.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.mes) ? q.mes : mesActualAR();
    const filas = await listarMes(ctx, mes);
    const cab: CabeceraPanel = {
      negocio: await nombreNegocio(),
      panel: ctx.panel.nombre,
      logoUrl: ctx.panel.logoUrl,
    };
    const suma = (f: typeof filas) => f.reduce((a, x) => a + Number(x.monto), 0).toFixed(2);
    const buffer = await exportarExcel(cab, {
      titulo: "Comisiones del pasista",
      archivo: `pasista-${ctx.panel.slug}-${mes}`,
      periodo: nombreMes(mes),
      filtros: [],
      tablas: [
        {
          titulo: "Comisiones",
          columnas: [
            { titulo: "Compra" },
            { titulo: "Tipo" },
            { titulo: "Fecha" },
            { titulo: "Proveedor", ancho: 2 },
            { titulo: "Unidades", tipo: "numero" },
            { titulo: "Base", tipo: "moneda" },
            { titulo: "%" },
            { titulo: "Comisión", tipo: "moneda" },
            { titulo: "Estado" },
            { titulo: "Pagada" },
            { titulo: "Medio" },
            { titulo: "Referencia" },
          ],
          filas: filas.map((f) => [
            f.compra,
            f.tipo === "AJUSTE" ? "Ajuste" : "Comisión",
            formatearFecha(f.fecha),
            f.proveedor ?? "—",
            f.unidades,
            f.base,
            f.porcentaje,
            f.monto,
            f.estado === "PAGADA" ? "Pagada" : "Pendiente",
            f.pagadaAt ? formatearFechaHora(f.pagadaAt) : "",
            f.medioPago ? ETIQUETA_MEDIO_PAGO[f.medioPago] : "",
            f.referencia ?? "",
          ]),
          totales: [
            "Total devengado",
            "",
            "",
            "",
            filas.reduce((a, f) => a + (f.tipo === "ORIGINAL" ? f.unidades : 0), 0),
            "",
            "",
            suma(filas),
            `Pendiente ${suma(filas.filter((f) => f.estado === "PENDIENTE"))}`,
            "",
            "",
            "",
          ],
        },
      ],
    });
    return respuestaExcel(buffer, `pasista-${ctx.panel.slug}-${mes}`);
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
