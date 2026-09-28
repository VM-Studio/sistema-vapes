import "server-only";

import { NextResponse } from "next/server";

function nombreConFecha(nombreBase: string, extension: string): string {
  return `${nombreBase}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** Respuesta de descarga CSV (con fecha en el nombre del archivo). */
export function respuestaCSV(contenido: string, nombreBase: string): NextResponse {
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreConFecha(nombreBase, "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Respuesta de descarga Excel .xlsx (con fecha en el nombre del archivo). */
export function respuestaExcel(contenido: Buffer, nombreBase: string): NextResponse {
  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreConFecha(nombreBase, "xlsx")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** URLSearchParams -> objeto plano para los schemas de filtros. */
export function paramsComoObjeto(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
