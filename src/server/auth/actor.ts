import "server-only";

import type { Actor } from "@/server/services/actor";

import { getRequestMeta } from "./request-meta";

/** Actor para los servicios (AuditLog) a partir del usuario ya autorizado. */
export async function actorDe(usuario: { id: string }): Promise<Actor> {
  return { id: usuario.id, meta: await getRequestMeta() };
}
