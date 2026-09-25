import { AccionAuditoria } from "@prisma/client";

import { prisma, withTransaction } from "@/lib/db";
import {
  CONFIG_ESCANER_DEFAULT,
  parsearConfigEscaner,
  type ConfigEscaner,
} from "@/features/scanner/config";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";

/** Parámetros del escáner (clave "escaner"): sufijos, prefijo, intervalo, largo mínimo, sonidos. */
export async function obtenerConfigEscaner(): Promise<ConfigEscaner> {
  const fila = await prisma.configuracion.findUnique({ where: { clave: "escaner" } });
  return fila ? parsearConfigEscaner(fila.valor) : CONFIG_ESCANER_DEFAULT;
}

export async function guardarConfigEscaner(
  config: ConfigEscaner,
  actor: Actor,
): Promise<ConfigEscaner> {
  return withTransaction(async (tx) => {
    const antes = await tx.configuracion.findUnique({ where: { clave: "escaner" } });
    const valor = { ...config, sufijos: [...config.sufijos] };
    await tx.configuracion.upsert({
      where: { clave: "escaner" },
      create: { clave: "escaner", valor },
      update: { valor },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "Configuracion",
      entidadId: "escaner",
      datosAntes: antes ? (antes.valor as object) : null,
      datosDespues: valor,
      meta: actor.meta,
    });
    return config;
  });
}
