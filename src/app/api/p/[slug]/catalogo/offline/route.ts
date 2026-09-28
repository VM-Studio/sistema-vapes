import { gzipSync } from "node:zlib";

import { Modulo } from "@prisma/client";

import { mapearErrorHttp } from "@/server/auth/http";
import { requireCtxAlguno } from "@/server/auth/permissions";
import {
  generarCatalogoOffline,
  versionCatalogo,
} from "@/server/services/catalogo-offline.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Módulos desde los que se escanea (cualquiera con "ver" alcanza para consultar el catálogo). */
const MODULOS_ESCANEO = [Modulo.STOCK, Modulo.COMPRAS, Modulo.PRODUCTOS, Modulo.VENTAS];

/**
 * GET /api/p/{slug}/catalogo/offline — snapshot del catálogo DEL PANEL para
 * IndexedDB (escáner sin señal, solo consulta). ETag = panel + versión: si el
 * celular ya la tiene, 304 sin cuerpo. El JSON va comprimido (gzip);
 * `Cache-Control: no-store` porque es un dato privado del negocio.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireCtxAlguno(MODULOS_ESCANEO, "ver");
    const version = await versionCatalogo(ctx);
    const etag = `"cat-${ctx.panelId}-${version}"`;
    const comunes = { ETag: etag, "Cache-Control": "private, no-store", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers: comunes });
    const cuerpo = JSON.stringify(await generarCatalogoOffline(ctx));
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
