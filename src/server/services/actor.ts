import type { RequestMeta } from "@/server/auth/request-meta";

/** Quién ejecuta una escritura: va a AuditLog (y a HistorialPrecio / MovimientoStock). */
export interface Actor {
  id: string;
  meta?: RequestMeta;
}
