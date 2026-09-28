import { AccionAuditoria } from "@prisma/client";

import { prisma, withTransaction } from "@/lib/db";
import type { Actor } from "@/server/services/actor";
import { registrarAuditoria } from "@/server/services/audit.service";
import { procesarImagenSubida } from "@/server/seguridad/archivos";
import { claveAleatoria, obtenerStorage } from "@/server/storage";

/**
 * Identidad del negocio para la app instalada: nombre (del manifest) e ícono
 * propio. El ícono se guarda re-codificado (PNG 1024 px, sin metadatos) en el
 * storage y /icons/[size] genera cada tamaño a partir de él.
 */
const CLAVE = "iconoApp";
let cache: { t: number; datos: Uint8Array | null } | null = null;

export async function nombreNegocio(): Promise<string> {
  try {
    const f = await prisma.configuracionGlobal.findUnique({ where: { clave: "nombreNegocio" } });
    return typeof f?.valor === "string" && f.valor.trim() ? f.valor.trim() : "Gestión";
  } catch {
    return "Gestión";
  }
}

/** Nombre del negocio (manifest de la app instalada, login, exportaciones). */
export async function guardarNombreNegocio(nombre: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const antes = await tx.configuracionGlobal.findUnique({ where: { clave: "nombreNegocio" } });
    await tx.configuracionGlobal.upsert({
      where: { clave: "nombreNegocio" },
      create: { clave: "nombreNegocio", valor: nombre },
      update: { valor: nombre },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "ConfiguracionGlobal",
      entidadId: "nombreNegocio",
      datosAntes: antes ? { nombreNegocio: antes.valor } : null,
      datosDespues: { nombreNegocio: nombre },
      meta: actor.meta,
    });
  });
}

export async function iconoPropio(): Promise<Uint8Array | null> {
  if (cache && Date.now() - cache.t < 5 * 60_000) return cache.datos;
  let datos: Uint8Array | null = null;
  try {
    const f = await prisma.configuracionGlobal.findUnique({ where: { clave: CLAVE } });
    const clave = (f?.valor as { clave?: string } | null)?.clave;
    if (clave) datos = (await obtenerStorage().leer(clave))?.datos ?? null;
  } catch {
    datos = null;
  }
  cache = { t: Date.now(), datos };
  return datos;
}

export async function tieneIconoPropio(): Promise<boolean> {
  return (await iconoPropio()) !== null;
}

export async function guardarIconoPropio(bytes: Uint8Array, actor: Actor): Promise<void> {
  const img = await procesarImagenSubida(bytes, { campo: "icono", maxLado: 1024, formato: "png" });
  if (Math.abs(img.ancho - img.alto) > 2)
    throw new (await import("@/server/errors")).ValidationError("El ícono tiene que ser cuadrado", {
      icono: ["Usá una imagen cuadrada (por ejemplo 1024 × 1024)"],
    });
  const clave = claveAleatoria("marca", "icono", "png");
  await obtenerStorage().guardar(clave, img.datos, img.tipo);
  await withTransaction(async (tx) => {
    await tx.configuracionGlobal.upsert({
      where: { clave: CLAVE },
      create: { clave: CLAVE, valor: { clave } },
      update: { valor: { clave } },
    });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.UPDATE,
      entidad: "ConfiguracionGlobal",
      entidadId: CLAVE,
      datosDespues: { clave },
      meta: actor.meta,
    });
  });
  cache = null;
}

export async function quitarIconoPropio(actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.configuracionGlobal.deleteMany({ where: { clave: CLAVE } });
    await registrarAuditoria(tx, {
      usuarioId: actor.id,
      accion: AccionAuditoria.DELETE,
      entidad: "ConfiguracionGlobal",
      entidadId: CLAVE,
      meta: actor.meta,
    });
  });
  cache = null;
}
