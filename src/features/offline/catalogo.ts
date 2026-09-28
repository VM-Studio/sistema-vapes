import { normalizarCodigoBarras } from "@/lib/barcode";
import type { PanelBasico } from "@/lib/paneles";
import type { CatalogoOffline } from "@/server/services/catalogo-offline.service";

import type { VarianteEscaneada } from "@/features/scanner/tipos";

import { abrirDb, claveCodigo, type MetaCatalogo, type VarianteGuardada } from "./db";

/**
 * Catálogo del escáner en IndexedDB, uno por panel: se baja al entrar al panel
 * y cada 15 minutos con red (si no cambió, el servidor responde 304 y no se
 * baja nada). Sin señal sirve solo para CONSULTAR (código → producto, precio, stock).
 */
export const INTERVALO_CATALOGO_MS = 15 * 60 * 1000;

export async function infoCatalogo(panelId: string): Promise<MetaCatalogo | null> {
  try {
    return (await (await abrirDb()).get("catalogos", panelId)) ?? null;
  } catch {
    return null;
  }
}

/** Todos los catálogos guardados en este celular (la página /offline elige panel). */
export async function listarCatalogos(): Promise<MetaCatalogo[]> {
  try {
    return await (await abrirDb()).getAll("catalogos");
  } catch {
    return [];
  }
}

export async function sincronizarCatalogo(
  panel: Pick<PanelBasico, "id" | "slug" | "nombre">,
  usuario: { id: string; nombre: string },
): Promise<{ estado: "actualizado" | "sin-cambios" | "error"; version?: string }> {
  let db: Awaited<ReturnType<typeof abrirDb>>;
  try {
    db = await abrirDb();
  } catch {
    return { estado: "error" };
  }
  const meta = await db.get("catalogos", panel.id);
  // Otro usuario en este celular: su catálogo no sirve (ni debe quedar a la vista).
  const mismoUsuario = meta?.usuarioId === usuario.id;
  let res: Response;
  try {
    res = await fetch(`/api/p/${panel.slug}/catalogo/offline`, {
      headers: mismoUsuario && meta ? { "If-None-Match": `"cat-${panel.id}-${meta.version}"` } : {},
      cache: "no-store",
    });
  } catch {
    return { estado: "error" };
  }
  if (res.status === 304 && meta && mismoUsuario) {
    await db.put("catalogos", {
      ...meta,
      panelSlug: panel.slug,
      panelNombre: panel.nombre,
      sincronizadoEn: Date.now(),
      usuarioNombre: usuario.nombre,
    });
    return { estado: "sin-cambios", version: meta.version };
  }
  if (!res.ok) return { estado: "error" };
  const cat = (await res.json()) as CatalogoOffline;
  if (cat.panelId !== panel.id) return { estado: "error" };

  const tx = db.transaction(["variantes", "catalogos"], "readwrite");
  const variantes = tx.objectStore("variantes");
  // Si cambió de usuario, fuera lo de todos los paneles; si no, solo lo de este panel.
  if (meta && !mismoUsuario) {
    await variantes.clear();
    await tx.objectStore("catalogos").clear();
  } else {
    let cursor = await variantes.index("porPanel").openCursor(IDBKeyRange.only(panel.id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  for (const v of cat.variantes) {
    const guardada: VarianteGuardada = {
      ...v,
      clave: `${panel.id}:${v.varianteId}`,
      panelId: panel.id,
      codigosPanel: v.codigos.map((c) => claveCodigo(panel.id, c)),
    };
    await variantes.put(guardada);
  }
  await tx.objectStore("catalogos").put({
    panelId: panel.id,
    panelSlug: panel.slug,
    panelNombre: panel.nombre,
    version: cat.version,
    sincronizadoEn: Date.now(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombre,
    depositos: cat.depositos,
    cantidad: cat.variantes.length,
  });
  await tx.done;
  return { estado: "actualizado", version: cat.version };
}

/** Busca un código escaneado (principal, alternativo o SKU) en el catálogo local DEL PANEL. */
export async function buscarEnCatalogo(
  panelId: string,
  codigo: string,
): Promise<VarianteEscaneada | null> {
  try {
    const db = await abrirDb();
    const c = normalizarCodigoBarras(codigo);
    const v = await db.getFromIndex("variantes", "porCodigo", claveCodigo(panelId, c));
    if (!v || v.panelId !== panelId) return null;
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

/** Al cerrar sesión: nada del negocio queda en el celular (catálogos de TODOS los paneles). */
export async function borrarCatalogo(): Promise<void> {
  try {
    const db = await abrirDb();
    const tx = db.transaction(["variantes", "catalogos"], "readwrite");
    await tx.objectStore("variantes").clear();
    await tx.objectStore("catalogos").clear();
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
