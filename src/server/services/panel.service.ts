import { AccionAuditoria, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { accedeAPanel, type SujetoPermisos } from "@/lib/permisos";
import { prefijoPanel } from "@/lib/paneles";
import type { CrearPanel } from "@/lib/validations/panel";
import { ahora } from "@/lib/reloj";
import { inicioDia, diaEn, ZONA_DEFAULT } from "@/lib/zona-horaria";
import {
  invalidarCachePaneles,
  panelesActivos,
  type PanelBasico,
} from "@/server/auth/paneles-acceso";
import type { RequestMeta } from "@/server/auth/request-meta";
import { ConflictError, NotFoundError } from "@/server/errors";
import { registrarAuditoria } from "@/server/services/audit.service";
import { procesarImagenSubida } from "@/server/seguridad/archivos";
import { claveAleatoria, obtenerStorage } from "@/server/storage";

/**
 * PANELES (servicio GLOBAL, solo dueños para escribir): alta, baja y listado
 * para el selector. Un panel nuevo es un sistema completo y vacío: nace con su
 * depósito "Principal" y sus secuencias de numeración.
 */

export type { PanelBasico };

export interface Quien {
  id: string;
  meta?: RequestMeta;
}

export const ENTIDADES_NUMERADAS = ["VENTA", "COMPRA", "TRANSFERENCIA", "DEVOLUCION"] as const;

/** Paneles activos a los que accede el usuario, en orden. */
export async function panelesDeUsuario(
  usuario: Pick<SujetoPermisos, "rol" | "paneles">,
): Promise<PanelBasico[]> {
  return (await panelesActivos()).filter((p) => accedeAPanel(usuario, p.id));
}

export interface ResumenPanel {
  panelId: string;
  ventasHoy: number;
  totalHoy: string;
  alertasStock: number;
}

/** Datos rápidos de las cards del selector (ventas de hoy y alertas de stock). */
export async function resumenesPaneles(panelIds: string[]): Promise<Map<string, ResumenPanel>> {
  if (panelIds.length === 0) return new Map();
  const desde = inicioDia(diaEn(ahora(), ZONA_DEFAULT), ZONA_DEFAULT);
  const [ventas, alertas] = await Promise.all([
    prisma.venta.groupBy({
      by: ["panelId"],
      where: { panelId: { in: panelIds }, estado: "CONFIRMADA", fecha: { gte: desde } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.$queryRaw<{ panel_id: string; n: bigint }[]>`
      SELECT panel_id, COUNT(*) AS n FROM vw_alertas_stock
      WHERE panel_id IN (${Prisma.join(panelIds)}) GROUP BY panel_id
    `,
  ]);
  return new Map(
    panelIds.map((id) => {
      const v = ventas.find((x) => x.panelId === id);
      return [
        id,
        {
          panelId: id,
          ventasHoy: v?._count._all ?? 0,
          totalHoy: (v?._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
          alertasStock: Number(alertas.find((a) => a.panel_id === id)?.n ?? 0),
        },
      ];
    }),
  );
}

/**
 * Crea un panel completo: Panel + depósito "Principal" + secuencias, en una
 * transacción. El nombre, el slug y el prefijo de IDs (3 letras del slug)
 * tienen que ser únicos: dos paneles con el mismo prefijo tendrían IDs de
 * venta indistinguibles.
 */
export async function crearPanel(
  input: CrearPanel,
  logo: Uint8Array | null,
  quien: Quien,
): Promise<PanelBasico> {
  const existentes = await prisma.panel.findMany({ select: { nombre: true, slug: true } });
  if (existentes.some((p) => p.nombre.toLowerCase() === input.nombre.toLowerCase()))
    throw new ConflictError("Ya existe un panel con ese nombre", { nombre: ["Ya existe"] });
  if (existentes.some((p) => p.slug === input.slug))
    throw new ConflictError("Ya existe un panel con esa dirección", { slug: ["Ya existe"] });
  const prefijo = prefijoPanel(input.slug);
  const choca = existentes.find((p) => prefijoPanel(p.slug) === prefijo);
  if (choca)
    throw new ConflictError(`El prefijo de IDs "${prefijo}" ya lo usa el panel ${choca.nombre}`, {
      slug: [`Empezá la dirección con otras letras (los IDs de venta serían ${prefijo}-000001)`],
    });

  let logoUrl: string | null = null;
  if (logo && logo.byteLength > 0) {
    const img = await procesarImagenSubida(logo, { campo: "logo", maxLado: 512, formato: "png" });
    logoUrl = await obtenerStorage().guardar(
      claveAleatoria("paneles", input.slug, "png"),
      img.datos,
      img.tipo,
    );
  }

  const orden = (await prisma.panel.aggregate({ _max: { orden: true } }))._max.orden ?? 0;
  const panel = await prisma.$transaction(async (tx) => {
    const p = await tx.panel.create({
      data: {
        nombre: input.nombre,
        slug: input.slug,
        colorAcento: input.colorAcento ?? null,
        etiquetaEspecificacion: input.etiquetaEspecificacion,
        logoUrl,
        orden: orden + 1,
      },
    });
    await tx.deposito.create({ data: { panelId: p.id, nombre: "Principal", esPrincipal: true } });
    await tx.secuencia.createMany({
      data: ENTIDADES_NUMERADAS.map((entidad) => ({ panelId: p.id, entidad, ultimoNumero: 0 })),
    });
    await registrarAuditoria(tx, {
      usuarioId: quien.id,
      accion: AccionAuditoria.CREATE,
      entidad: "Panel",
      entidadId: p.id,
      datosDespues: { nombre: p.nombre, slug: p.slug, colorAcento: p.colorAcento },
      meta: quien.meta,
    });
    return p;
  });
  invalidarCachePaneles();
  return {
    id: panel.id,
    nombre: panel.nombre,
    slug: panel.slug,
    logoUrl: panel.logoUrl,
    colorAcento: panel.colorAcento,
    etiquetaEspecificacion: panel.etiquetaEspecificacion,
    orden: panel.orden,
  };
}

/** Baja lógica: el panel deja de aparecer y de ser accesible; sus datos quedan. */
export async function desactivarPanel(panelId: string, quien: Quien): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const p = await tx.panel.findUnique({ where: { id: panelId } });
    if (!p) throw new NotFoundError("El panel no existe");
    if (!p.activo) return;
    await tx.panel.update({ where: { id: panelId }, data: { activo: false } });
    await registrarAuditoria(tx, {
      usuarioId: quien.id,
      accion: AccionAuditoria.DELETE,
      entidad: "Panel",
      entidadId: panelId,
      datosAntes: { activo: true },
      datosDespues: { activo: false },
      meta: quien.meta,
    });
  });
  invalidarCachePaneles();
}

/** Todos los paneles (activos e inactivos): administración de usuarios. */
export async function listarTodosLosPaneles() {
  return prisma.panel.findMany({
    orderBy: [{ activo: "desc" }, { orden: "asc" }],
    select: { id: true, nombre: true, slug: true, logoUrl: true, colorAcento: true, activo: true },
  });
}
