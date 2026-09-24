import "server-only";

import { NextResponse } from "next/server";

/** Respuesta de descarga CSV (con fecha en el nombre del archivo). */
export function respuestaCSV(contenido: string, nombreBase: string): NextResponse {
  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreBase}-${fecha}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** URLSearchParams -> objeto plano para los schemas de filtros. */
export function paramsComoObjeto(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
