import { NextResponse } from "next/server";

import { esClaveValida, obtenerStorage } from "@/server/storage";

export const runtime = "nodejs";

/**
 * GET /api/publico/archivos/<clave> — archivos privados por link (PDF de una
 * cotización compartida por WhatsApp, etiquetas) sin sesión: la clave tiene 24
 * bytes aleatorios, no se puede adivinar ni recorrer.
 * Local: sirve el archivo. S3/R2: redirige a una URL firmada de 5 minutos.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ clave: string[] }> }) {
  const clave = (await params).clave.join("/");
  if (!esClaveValida(clave) || clave.startsWith("backups"))
    return new Response("No encontrado", { status: 404 });
  const storage = obtenerStorage();
  if (storage.nombre === "s3") {
    if (!(await storage.existe(clave))) return new Response("No encontrado", { status: 404 });
    return NextResponse.redirect(await storage.urlFirmada(clave, 300), {
      status: 302,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    });
  }
  const archivo = await storage.leer(clave);
  if (!archivo) return new Response("No encontrado", { status: 404 });
  return new Response(Buffer.from(archivo.datos), {
    headers: {
      "Content-Type": archivo.tipo,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
