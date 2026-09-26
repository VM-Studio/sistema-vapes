import { timingSafeEqual } from "node:crypto";

/**
 * Rutas /api/cron/*: sin sesión, protegidas por CRON_SECRET en el header
 * `Authorization: Bearer <secreto>` (lo que manda Vercel Cron) o
 * `x-cron-secret: <secreto>`. Sin secreto configurado, no corren.
 */
export function cronAutorizado(req: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || secreto.length < 16) return false;
  const auth = req.headers.get("authorization");
  const recibido = auth?.startsWith("Bearer ") ? auth.slice(7) : req.headers.get("x-cron-secret");
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}
