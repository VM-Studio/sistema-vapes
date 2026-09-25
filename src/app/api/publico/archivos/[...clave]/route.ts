import { esClaveValida, storage } from "@/server/storage";

export const runtime = "nodejs";

/**
 * GET /api/publico/archivos/<clave> — archivos generados (PDF de comprobantes)
 * sin sesión: es el link que se manda por WhatsApp. La clave tiene 24 bytes
 * aleatorios, así que no se puede adivinar ni recorrer.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ clave: string[] }> }) {
  const clave = (await params).clave.join("/");
  if (!esClaveValida(clave)) return new Response("No encontrado", { status: 404 });
  const archivo = await storage.leer(clave);
  if (!archivo) return new Response("No encontrado", { status: 404 });
  return new Response(Buffer.from(archivo.datos), {
    headers: {
      "Content-Type": archivo.tipo,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
