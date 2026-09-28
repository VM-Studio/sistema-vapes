import type { RequestMeta } from "@/server/auth/request-meta";

/** Quién ejecuta una escritura GLOBAL (usuarios, paneles, identidad): va a AuditLog. Lo de negocio usa Ctx. */
export interface Actor {
  id: string;
  meta?: RequestMeta;
}
