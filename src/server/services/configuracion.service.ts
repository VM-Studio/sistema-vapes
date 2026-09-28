import { AccionAuditoria, type Prisma } from "@prisma/client";

import {
  CONFIG_ESCANER_DEFAULT,
  parsearConfigEscaner,
  type ConfigEscaner,
} from "@/features/scanner/config";
import { configCatalogoSchema, type ConfigCatalogo } from "@/lib/validations/config-panel";
import { configVentasSchema, type ConfigVentas } from "@/lib/validations/venta";
import { dbPara, transaccion, type Ctx, type Tx } from "@/server/db/panel-scoped";
import { registrarAuditoria } from "@/server/services/audit.service";

export type { ConfigCatalogo, ConfigVentas };

/**
 * Configuración POR PANEL (clave/valor en Configuracion): cada panel tiene su
 * escáner, su cobro, su prefijo de SKU y sus alertas. La lectura va con
 * dbPara (solo ve filas del panel); la escritura, con auditoría.
 */

async function leer(tx: Tx, clave: string): Promise<Prisma.JsonValue | undefined> {
  const fila = await tx.configuracion.findFirst({ where: { clave } });
  return fila?.valor;
}

async function guardar(
  ctx: Ctx,
  entidadId: string,
  valores: Record<string, Prisma.InputJsonValue>,
): Promise<void> {
  await transaccion(ctx, async (tx) => {
    const claves = Object.keys(valores);
    const antes = await tx.configuracion.findMany({ where: { clave: { in: claves } } });
    for (const [clave, valor] of Object.entries(valores)) {
      await tx.configuracion.upsert({
        where: { panelId_clave: { panelId: ctx.panelId, clave } },
        create: { clave, valor },
        update: { valor },
      });
    }
    await registrarAuditoria(tx, {
      usuarioId: ctx.usuarioId,
      accion: AccionAuditoria.UPDATE,
      entidad: "Configuracion",
      entidadId,
      datosAntes: Object.fromEntries(antes.map((f) => [f.clave, f.valor as Prisma.InputJsonValue])),
      datosDespues: valores,
      meta: ctx.meta,
    });
  });
}

// =============================================================================
// Escáner (clave "escaner"): sufijos, prefijo, intervalo, largo mínimo, sonidos
// =============================================================================

export async function obtenerConfigEscaner(ctx: Pick<Ctx, "panelId">): Promise<ConfigEscaner> {
  const valor = await leer(dbPara(ctx.panelId), "escaner");
  return valor === undefined ? CONFIG_ESCANER_DEFAULT : parsearConfigEscaner(valor);
}

export async function guardarConfigEscaner(
  ctx: Ctx,
  config: ConfigEscaner,
): Promise<ConfigEscaner> {
  await guardar(ctx, "escaner", { escaner: { ...config, sufijos: [...config.sufijos] } });
  return config;
}

// =============================================================================
// Ventas (clave "ventas"): redondeo del POS
// =============================================================================

export async function obtenerConfigVentas(
  ctx: Pick<Ctx, "panelId">,
  tx: Tx = dbPara(ctx.panelId),
): Promise<ConfigVentas> {
  const r = configVentasSchema.safeParse((await leer(tx, "ventas")) ?? {});
  return r.success ? r.data : configVentasSchema.parse({});
}

export async function guardarConfigVentas(ctx: Ctx, config: ConfigVentas): Promise<ConfigVentas> {
  await guardar(ctx, "ventas", { ventas: { ...config } });
  return config;
}

// =============================================================================
// Catálogo (claves "prefijoSku" y "alertaStockMinimo")
// =============================================================================

export async function obtenerConfigCatalogo(ctx: Pick<Ctx, "panelId">): Promise<ConfigCatalogo> {
  const db = dbPara(ctx.panelId);
  const [prefijoSku, alertaStockMinimo] = await Promise.all([
    leer(db, "prefijoSku"),
    leer(db, "alertaStockMinimo"),
  ]);
  const r = configCatalogoSchema.safeParse({
    ...(typeof prefijoSku === "string" ? { prefijoSku } : {}),
    ...(typeof alertaStockMinimo === "boolean" ? { alertaStockMinimo } : {}),
  });
  return r.success ? r.data : configCatalogoSchema.parse({});
}

export async function guardarConfigCatalogo(
  ctx: Ctx,
  config: ConfigCatalogo,
): Promise<ConfigCatalogo> {
  await guardar(ctx, "catalogo", {
    prefijoSku: config.prefijoSku,
    alertaStockMinimo: config.alertaStockMinimo,
  });
  return config;
}
