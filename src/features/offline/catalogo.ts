import { normalizarCodigoBarras } from "@/lib/barcode";
import type { CatalogoOffline } from "@/server/services/catalogo-offline.service";

import type { VarianteEscaneada } from "@/features/scanner/tipos";

import { abrirDb, type MetaCatalogo, type PermisosOffline } from "./db";

/**
 * Catálogo del escáner en IndexedDB: se baja al iniciar sesión y cada 15
 * minutos con red (si no cambió, el servidor responde 304 y no se baja nada).
 */
export const INTERVALO_CATALOGO_MS = 15 * 60 * 1000;

export async function infoCatalogo(): Promise<MetaCatalogo | null> {
  try {
    return (await (await abrirDb()).get("meta", "catalogo")) ?? null;
  } catch {
    return null;
  }
}

export async function sincronizarCatalogo(usuario: {
  id: string;
  nombre: string;
  permisos: PermisosOffline;
}): Promise<{ estado: "actualizado" | "sin-cambios" | "error"; version?: string }> {
  const db = await abrirDb();
  const meta = await db.get("meta", "catalogo");
  // Otro usuario en este celular: su catálogo no sirve (ni debe quedar a la vista).
  const mismoUsuario = meta?.usuarioId === usuario.id;
  let res: Response;
  try {
    res = await fetch("/api/catalogo/offline", {
      headers: mismoUsuario && meta ? { "If-None-Match": `"cat-${meta.version}"` } : {},
      cache: "no-store",
    });
  } catch {
    return { estado: "error" };
  }
  if (res.status === 304 && meta && mismoUsuario) {
    await db.put("meta", {
      ...meta,
      sincronizadoEn: Date.now(),
      permisos: usuario.permisos,
      usuarioNombre: usuario.nombre,
    });
    return { estado: "sin-cambios", version: meta.version };
  }
  if (!res.ok) return { estado: "error" };
  const cat = (await res.json()) as CatalogoOffline;
  const tx = db.transaction(["variantes", "meta"], "readwrite");
  await tx.objectStore("variantes").clear();
  for (const v of cat.variantes) await tx.objectStore("variantes").put(v);
  await tx.objectStore("meta").put({
    clave: "catalogo",
    version: cat.version,
    sincronizadoEn: Date.now(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombre,
    depositos: cat.depositos,
    permisos: usuario.permisos,
    cantidad: cat.variantes.length,
  });
  await tx.done;
  return { estado: "actualizado", version: cat.version };
}

/** Busca un código escaneado (principal, alternativo o SKU) en el catálogo local. */
export async function buscarEnCatalogo(codigo: string): Promise<VarianteEscaneada | null> {
  try {
    const db = await abrirDb();
    const c = normalizarCodigoBarras(codigo);
    const v = await db.getFromIndex("variantes", "porCodigo", c);
    if (!v) return null;
    return {
      varianteId: v.varianteId,
      productoId: v.productoId,
      producto: v.producto,
      variante: v.variante,
      nombreCompleto: v.nombreCompleto,
      sku: v.sku,
      codigoBarras: v.codigoBarras,
      porCodigoAlternativo: v.alternativos.includes(c),
      marca: v.marca,
      categoria: v.categoria,
      imagenUrl: v.imagenUrl,
      activo: true,
      precioCosto: null, // el catálogo offline no lleva costos
      precioVenta: v.precioVenta,
      stockMinimo: v.stockMinimo,
      stock: v.stock,
      stockTotal: v.stockTotal,
    };
  } catch {
    return null;
  }
}

/** Al cerrar sesión: nada del negocio queda en el celular. */
export async function borrarCatalogo(): Promise<void> {
  try {
    const db = await abrirDb();
    const tx = db.transaction(["variantes", "meta"], "readwrite");
    await tx.objectStore("variantes").clear();
    await tx.objectStore("meta").clear();
    await tx.done;
  } catch {
    /* sin IndexedDB */
  }
}

export function haceCuantoTexto(ms: number, ahora = Date.now()): string {
  const min = Math.floor((ahora - ms) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}
