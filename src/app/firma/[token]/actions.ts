"use server";

import { firmarConTokenSchema } from "@/lib/validations/ganancia-vendedor";
import { actionHandler } from "@/server/action-handler";
import { getRequestMeta } from "@/server/auth/request-meta";
import { RateLimitError } from "@/server/errors";
import { consumir } from "@/server/seguridad/rate-limit";
import { firmarConToken } from "@/server/services/remito-liquidacion.service";

/**
 * "Firmado" desde el link público (sin sesión): el token es la credencial
 * (un solo uso, vence). Rate limit propio por IP, además del general.
 */
export const firmarConTokenAction = actionHandler(async (input: unknown) => {
  const meta = await getRequestMeta();
  const r = await consumir(`firma:${meta.ip ?? "local"}`, 10);
  if (!r.permitido)
    throw new RateLimitError("Demasiados intentos: esperá un minuto.", r.reintentarEnSegundos);
  const { token, firma } = firmarConTokenSchema.parse(input);
  await firmarConToken(token, firma, meta);
  return { ok: true };
});
