"use server";

import {
  cambiarPasswordConCodigoSchema,
  cambiarPasswordSchema,
  codigoMailSchema,
} from "@/lib/validations/usuario";
import { actionHandler } from "@/server/action-handler";
import { getSesion } from "@/server/auth/current-user";
import { requireUsuario } from "@/server/auth/permissions";
import { getRequestMeta } from "@/server/auth/request-meta";
import { revocarSesionesDeUsuario } from "@/server/auth/sesiones";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";
import { mailConfigurado } from "@/server/mail";
import { cambiarPasswordPropia } from "@/server/services/auth.service";
import {
  cambiarPasswordConToken,
  enviarCodigoCambioPassword,
  verificarCodigo,
} from "@/server/services/codigo-verificacion.service";

/**
 * Cambio de la propia contraseña (incluso con el cambio pendiente), en 3 pasos:
 * código por mail → validarlo → contraseña nueva. Todo atado a la sesión
 * actual (sid del JWT): el código y el token no sirven desde otra.
 */
async function usuarioYSesion() {
  const usuario = await requireUsuario({ permitirCambioPendiente: true });
  const sesion = await getSesion();
  if (!sesion || sesion.sub !== usuario.id) throw new UnauthorizedError();
  return { usuario, sid: sesion.sid };
}

/** Paso 1 (y «Reenviar»): manda el código al email del usuario logueado. */
export const enviarCodigoAction = actionHandler(async () => {
  const { usuario, sid } = await usuarioYSesion();
  const r = await enviarCodigoCambioPassword(
    { id: usuario.id, nombre: usuario.nombre, email: usuario.email },
    sid,
  );
  return r.estado === "ENVIADO" ? { ...r, venceAt: r.venceAt.toISOString() } : { estado: r.estado };
});

/** Paso 2: valida el código y devuelve el token de verificación (10 min). */
export const verificarCodigoAction = actionHandler(async (input: unknown) => {
  const { usuario, sid } = await usuarioYSesion();
  const { codigo } = codigoMailSchema.parse(input);
  const r = await verificarCodigo(usuario.id, sid, codigo);
  return { token: r.token, venceAt: r.venceAt.toISOString() };
});

/** Paso 3: contraseña nueva con el token del paso 2. */
export const cambiarPasswordConCodigoAction = actionHandler(async (input: unknown) => {
  const { usuario, sid } = await usuarioYSesion();
  const datos = cambiarPasswordConCodigoSchema.parse(input);
  return cambiarPasswordConToken(usuario.id, sid, datos, await getRequestMeta());
});

/**
 * Camino viejo (pide la actual): SOLO si el servidor no tiene mail
 * configurado, para que nadie quede trabado (p. ej. con la temporal).
 * Con mail configurado se rechaza aunque el cliente lo invoque.
 */
export const cambiarPasswordAction = actionHandler(async (input: unknown) => {
  const usuario = await requireUsuario({ permitirCambioPendiente: true });
  if (mailConfigurado()) {
    throw new ForbiddenError("Para cambiar la contraseña pedí el código por mail.");
  }
  const datos = cambiarPasswordSchema.parse(input);
  await cambiarPasswordPropia(usuario.id, datos, await getRequestMeta());
  // Si era el cambio obligatorio, recién ahora puede entrar al resto del sistema.
  return { habilitado: usuario.debeCambiarPassword };
});

/** "Cerrar sesión en todos los dispositivos" (incluido este: se vuelve al login). */
export const cerrarTodasLasSesionesAction = actionHandler(async () => {
  const usuario = await requireUsuario({ permitirCambioPendiente: true });
  return {
    revocadas: await revocarSesionesDeUsuario(usuario.id, {
      id: usuario.id,
      meta: await getRequestMeta(),
    }),
  };
});
