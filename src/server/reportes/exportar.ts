import "server-only";

import { Modulo } from "@prisma/client";

import { ahora } from "@/lib/reloj";
import { parametrosDesdeUrl } from "@/lib/reportes/parametros";
import { diaEn } from "@/lib/zona-horaria";
import { NotFoundError } from "@/server/errors";
import { requirePermiso, type UsuarioConPermisos } from "@/server/auth/permissions";
import { obtenerConfigVentas } from "@/server/services/configuracion.service";

import { contextoReporte, reportePorSlug } from "./definiciones";
import { generarPdfReporte, type MetaPdf } from "./pdf-reporte";

/**
 * Autoriza y arma un reporte para exportarlo. Mismas reglas que la pantalla:
 * REPORTES "ver"; los de dinero exigen FINANZAS "ver" (si no, 403); los de
 * gastos / clientes, además, su módulo. Sin FINANZAS, las columnas de costo y
 * ganancia no se incluyen.
 */
export async function prepararReporte(
  slug: string,
  query: URLSearchParams | Record<string, string>,
) {
  const usuario: UsuarioConPermisos = await requirePermiso(Modulo.REPORTES, "ver");
  const def = reportePorSlug(slug);
  if (!def) throw new NotFoundError("El reporte no existe");
  if (def.finanzas) await requirePermiso(Modulo.FINANZAS, "ver");
  if (def.modulo) await requirePermiso(def.modulo, "ver");
  const ctx = await contextoReporte(usuario);
  const p = parametrosDesdeUrl(query, diaEn(ahora(), ctx.tz), def.periodoPorDefecto);
  const [doc, config] = await Promise.all([def.construir(p, ctx), obtenerConfigVentas()]);
  const meta: MetaPdf & { tz: string } = {
    negocio: config.nombreNegocio,
    generadoPor: usuario.nombre,
    generadoEn: ahora(),
    tz: ctx.tz,
  };
  const nombre = `${def.slug}${def.filtros.includes("periodo") ? `-${p.rango.desde}_${p.rango.hasta}` : `-${diaEn(ahora(), ctx.tz)}`}`;
  return { def, doc, meta, nombre };
}

export async function pdfDeReporte(slug: string, query: URLSearchParams | Record<string, string>) {
  const r = await prepararReporte(slug, query);
  return { ...r, pdf: await generarPdfReporte(r.doc, r.meta) };
}
