import { gzipSync } from "node:zlib";

import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requirePermisoAlguno } from "@/server/auth/permissions";
import {
  generarCatalogoOffline,
  versionCatalogo,
} from "@/server/services/catalogo-offline.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODULOS_ESCANEO = [
  Modulo.INVENTARIO,
  Modulo.MOVIMIENTOS,
  Modulo.COMPRAS,
  Modulo.PRODUCTOS,
  Modulo.VENTAS,
];

/**
 * GET /api/catalogo/offline — snapshot para IndexedDB (escáner sin señal).
 * ETag = versión del catálogo: si el celular ya la tiene, 304 sin cuerpo.
 * El JSON va comprimido (gzip); `Cache-Control: no-store` porque es un dato
 * privado del negocio (lo guarda la app en IndexedDB, no el caché HTTP).
 */
export async function GET(req: Request) {
  try {
    await requirePermisoAlguno(MODULOS_ESCANEO, "ver");
    const version = await versionCatalogo();
    const etag = `"cat-${version}"`;
    const comunes = { ETag: etag, "Cache-Control": "private, no-store", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers: comunes });
    const cuerpo = JSON.stringify(await generarCatalogoOffline());
    if (req.headers.get("accept-encoding")?.includes("gzip")) {
      return new Response(gzipSync(cuerpo), {
        headers: {
          ...comunes,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Encoding": "gzip",
        },
      });
    }
    return new Response(cuerpo, {
      headers: { ...comunes, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return mapearErrorHttp(error);
  }
}
