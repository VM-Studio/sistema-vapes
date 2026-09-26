import { readFile } from "node:fs/promises";
import path from "node:path";

import { generarIcono, type VarianteIcono } from "@/lib/iconos-app";
import { iconoPropio } from "@/server/services/identidad.service";

export const runtime = "nodejs";

const VARIANTES = new Set<VarianteIcono>(["192", "512", "maskable", "apple", "favicon"]);

/**
 * /icons/192 · /icons/512 · /icons/maskable · /icons/apple · /icons/favicon
 * Con ícono propio del negocio (/configuracion/negocio) se genera desde ese;
 * si no, se sirve el base de /public/icons (el que produce `pnpm iconos`).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!VARIANTES.has(size as VarianteIcono)) return new Response("No encontrado", { status: 404 });
  const propio = await iconoPropio();
  const png = propio
    ? await generarIcono(propio, size as VarianteIcono)
    : await readFile(path.join(process.cwd(), "public/icons", `icon-${size}.png`));
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
