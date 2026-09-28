/**
 * Pruebas de la capa de auth/permisos a nivel servicio + DB.
 * Uso: pnpm test:auth   (requiere migraciones + seed; lee AUTH_SECRET de .env)
 *
 * Deja rastro mínimo: filas de IntentoLogin de un email ficticio, una sesión
 * revocada del dueño, y dos cambios de acceso de la empleada del seed (se le
 * habilita Cosmetic y después se restaura su acceso original, con su AuditLog).
 */
import { AccionAuditoria, Modulo, RolUsuario } from "@prisma/client";
import { SignJWT } from "jose";

import { prisma } from "../src/lib/db";
import { accedeAPanel, MODULOS_DE_PANEL, normalizarPermiso, puede } from "../src/lib/permisos";
import {
  esPasswordComun,
  generarPasswordTemporal,
  validarFortaleza,
} from "../src/server/auth/password";
import {
  crearToken,
  debeRenovar,
  DURACION_SESION_S,
  verificarToken,
} from "../src/server/auth/session";
import {
  crearSesion,
  invalidarCacheSesiones,
  revocarSesion,
  validarSesion,
} from "../src/server/auth/sesiones";
import {
  ConflictError,
  DomainError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "../src/server/errors";
import { snapshotUsuario } from "../src/server/services/audit.service";
import { autenticar, MAX_INTENTOS_FALLIDOS } from "../src/server/services/auth.service";
import { obtenerUsuarioSesion } from "../src/server/services/sesion.service";
import {
  actualizarAcceso,
  actualizarUsuario,
  crearUsuario,
  darDeBajaUsuario,
  obtenerAcceso,
  resetearPassword,
} from "../src/server/services/usuario.service";

const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const ESPECIALES = "pnl_especiales";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

class Rollback extends Error {}

function mensaje(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const conector = /message: "((?:[^"\\]|\\.)*)"/.exec(msg)?.[1]?.replace(/\\"/g, '"');
  const pg = /ERROR: ([^`\n]+)/.exec(msg)?.[1];
  return conector ?? pg ?? msg.split("\n").filter(Boolean).pop() ?? msg;
}

async function rechaza<E extends Error>(
  desc: string,
  fn: () => Promise<unknown>,
  tipo: (new (...a: never[]) => E) | null,
  contiene: string,
) {
  try {
    await fn();
    check(false, `${desc}: NO fue rechazado`);
  } catch (e) {
    if (e instanceof Rollback) return check(false, `${desc}: NO fue rechazado`);
    const m = mensaje(e);
    check((tipo === null || e instanceof tipo) && m.includes(contiene), `${desc} → "${m}"`);
  }
}

async function main() {
  const [owner, owner2] = await prisma.usuario.findMany({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const empleado = await prisma.usuario.findFirst({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
  });
  if (!owner || !owner2 || !empleado) throw new Error("Corré primero el seed base (pnpm db:seed).");
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-auth" } };

  console.log("\nA) Sesión (JWT HS256)");
  const token = await crearToken({
    id: owner.id,
    rol: RolUsuario.OWNER,
    sid: "sid-test",
    tok: "tok-test",
  });
  const payload = await verificarToken(token);
  check(payload?.sub === owner.id && payload.rol === "OWNER", "token válido: sub + rol");
  check(
    payload !== null &&
      Object.keys(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()))
        .sort()
        .join() === "exp,iat,rol,sid,sub,tok",
    "payload solo trae sub, rol, sid, tok, iat, exp (sin permisos ni paneles)",
  );
  check(payload !== null && payload.exp - payload.iat === DURACION_SESION_S, "vence a los 7 días");
  const [h, p, firma] = token.split(".");
  check(
    (await verificarToken(`${h}.${p}.${firma!.slice(0, -3)}abc`)) === null,
    "firma adulterada → inválido",
  );
  const pAdulterado = Buffer.from(
    JSON.stringify({ sub: empleado.id, rol: "OWNER", iat: 1, exp: 9999999999 }),
  ).toString("base64url");
  check(
    (await verificarToken(`${h}.${pAdulterado}.${firma}`)) === null,
    "payload adulterado (escalar a OWNER) → inválido",
  );
  const otroSecreto = await new SignJWT({ rol: "OWNER" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(owner.id)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("otro-secreto-de-al-menos-32-caracteres!!"));
  check((await verificarToken(otroSecreto)) === null, "firmado con otro secreto → inválido");
  const sinFirma = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
  check((await verificarToken(sinFirma)) === null, 'alg "none" → inválido');
  const vencido = await new SignJWT({ rol: "OWNER" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(owner.id)
    .setIssuedAt(1000)
    .setExpirationTime(2000)
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  check((await verificarToken(vencido)) === null, "vencido → inválido");
  const ahora = Math.floor(Date.now() / 1000);
  check(
    !debeRenovar({
      sub: "x",
      rol: "OWNER",
      sid: "s",
      tok: "t",
      iat: ahora,
      exp: ahora + 5 * 86400,
    }),
    "faltan 5 días → no renueva",
  );
  check(
    debeRenovar({ sub: "x", rol: "OWNER", sid: "s", tok: "t", iat: ahora, exp: ahora + 2 * 86400 }),
    "faltan 2 días (<3) → renueva",
  );

  console.log("B) Sesiones revocables (tabla Sesion)");
  const sesion = await crearSesion(owner.id, actor.meta);
  // validarSesion cachea por sid 60 s: se limpia el caché para probar cada caso contra la DB.
  check(
    (await validarSesion(sesion.sid, "otro-token")) === null,
    "sid correcto con otro secreto → inválida",
  );
  invalidarCacheSesiones();
  const estado = await validarSesion(sesion.sid, sesion.tok);
  check(estado?.usuarioId === owner.id && estado.rol === "OWNER", "sesión recién creada: válida");
  await revocarSesion(sesion.sid, owner.id);
  check(
    (await validarSesion(sesion.sid, sesion.tok)) === null,
    "sesión revocada → inválida al instante",
  );
  const sesionEmp = await crearSesion(empleado.id, actor.meta);
  const estadoEmp = await validarSesion(sesionEmp.sid, sesionEmp.tok);
  check(
    estadoEmp?.paneles.includes(VAPES) === true && !estadoEmp.paneles.includes(COSMETIC),
    `la sesión del empleado trae sus paneles (${estadoEmp?.paneles.join(", ")})`,
  );
  await revocarSesion(sesionEmp.sid, owner.id);

  console.log("C) Contraseñas");
  check(validarFortaleza("clave1234").ok, '"clave1234" válida (letra + número, 8+)');
  check(!validarFortaleza("clave12").ok, "7 caracteres → inválida");
  check(!validarFortaleza("solamenteletras").ok, "sin número → inválida");
  check(!validarFortaleza("1234567890").ok, "sin letra → inválida");
  check(
    esPasswordComun("password1") && esPasswordComun(" PASSWORD1 "),
    "«password1» está entre las comunes",
  );
  check(!esPasswordComun(generarPasswordTemporal()), "una temporal no es común");
  const temporales = Array.from({ length: 500 }, () => generarPasswordTemporal());
  check(
    temporales.every((t) => t.length === 12 && validarFortaleza(t).ok && !/[0O1lI]/.test(t)),
    "500 temporales: 12 caracteres, cumplen la política, sin caracteres ambiguos",
  );
  check(new Set(temporales).size === 500, "500 temporales distintas");
  await rechaza(
    "crear usuario con una contraseña común",
    () =>
      crearUsuario(actor, {
        nombre: "X",
        email: `comun-${Date.now()}@test.local`,
        rol: RolUsuario.EMPLEADO,
        password: "password1",
      }),
    ValidationError,
    "de las más usadas",
  );

  console.log("D) Login (servicio) y bloqueo por intentos");
  const emailFicticio = `noexiste-${Date.now()}@test.local`;
  await rechaza(
    "email inexistente",
    () => autenticar(emailFicticio, "loquesea1", actor.meta),
    UnauthorizedError,
    "Credenciales inválidas",
  );
  await rechaza(
    "password incorrecta (mismo mensaje)",
    () => autenticar(owner.email, "incorrecta1", actor.meta),
    UnauthorizedError,
    "Credenciales inválidas",
  );
  check(
    (await prisma.intentoLogin.count({ where: { email: emailFicticio, exitoso: false } })) === 1,
    "el intento fallido quedó registrado en IntentoLogin (persistente)",
  );
  for (let i = 1; i < MAX_INTENTOS_FALLIDOS; i++) {
    await autenticar(emailFicticio, `mala${i}abc`, actor.meta).catch(() => undefined);
  }
  await rechaza(
    `intento ${MAX_INTENTOS_FALLIDOS + 1} dentro de la ventana → bloqueado`,
    () => autenticar(emailFicticio, "loquesea1", actor.meta),
    RateLimitError,
    "Demasiados intentos fallidos",
  );
  const concurrentes = await Promise.allSettled(
    Array.from({ length: 10 }, () => autenticar(emailFicticio, "otra1234", actor.meta)),
  );
  check(
    concurrentes.every((r) => r.status === "rejected" && r.reason instanceof RateLimitError),
    "10 intentos en paralelo durante el bloqueo: todos rechazados",
  );
  check(
    (await prisma.intentoLogin.count({ where: { email: emailFicticio } })) ===
      MAX_INTENTOS_FALLIDOS,
    `los intentos bloqueados no se registran (${MAX_INTENTOS_FALLIDOS} filas)`,
  );

  console.log("E) Reglas de dueños (servicio)");
  await rechaza(
    "desactivarse a uno mismo",
    () =>
      actualizarUsuario(actor, {
        id: owner.id,
        nombre: owner.nombre,
        email: owner.email,
        rol: RolUsuario.OWNER,
        activo: false,
      }),
    DomainError,
    "No podés desactivar tu propio usuario",
  );
  await rechaza(
    "bajarse de rol a uno mismo",
    () =>
      actualizarUsuario(actor, {
        id: owner.id,
        nombre: owner.nombre,
        email: owner.email,
        rol: RolUsuario.EMPLEADO,
        activo: true,
      }),
    DomainError,
    "No podés quitarte el rol de dueño",
  );
  await rechaza(
    "darse de baja a uno mismo",
    () => darDeBajaUsuario(actor, owner.id),
    DomainError,
    "No podés dar de baja tu propio usuario",
  );
  await rechaza(
    "resetear la propia contraseña desde Usuarios",
    () => resetearPassword(actor, owner.id),
    DomainError,
    "Mi cuenta",
  );
  await rechaza(
    "crear usuario con email existente",
    () =>
      crearUsuario(actor, {
        nombre: "X",
        email: owner2.email,
        rol: RolUsuario.EMPLEADO,
        password: "clave1234xyz",
      }),
    ConflictError,
    "Ya existe un usuario con ese email",
  );
  await rechaza(
    "asignar acceso por panel a un OWNER",
    () => actualizarAcceso(actor, { usuarioId: owner.id, paneles: [] }),
    DomainError,
    "no se les asignan permisos",
  );
  await rechaza(
    "habilitar un panel inexistente",
    () =>
      actualizarAcceso(actor, {
        usuarioId: empleado.id,
        paneles: [{ panelId: "pnl_no_existe", permisos: [] }],
      }),
    null,
    "no existe",
  );

  console.log("F) Acceso por panel (actualizarAcceso)");
  const original = await obtenerAcceso(empleado.id);
  check(
    original.paneles.length === 1 && original.paneles[0] === VAPES,
    `la empleada del seed accede solo a Vapes (${original.paneles.join(", ")})`,
  );
  const aInput = (a: typeof original) => ({
    usuarioId: empleado.id,
    paneles: a.paneles.map((panelId) => ({
      panelId,
      permisos: a.permisos.filter((x) => x.panelId === panelId && x.puedeVer),
    })),
  });
  const nuevo = aInput(original);
  nuevo.paneles.push({
    panelId: COSMETIC,
    permisos: [
      normalizarPermiso({
        panelId: COSMETIC,
        modulo: Modulo.VENTAS,
        puedeVer: false,
        puedeCrear: true,
        puedeEditar: false,
        puedeEliminar: false,
      }),
    ],
  });
  const acceso = await actualizarAcceso(actor, nuevo);
  check(
    acceso.paneles.sort().join() === [COSMETIC, VAPES].sort().join() &&
      acceso.permisos.filter((x) => x.panelId === COSMETIC).length === MODULOS_DE_PANEL.length,
    "habilitar Cosmetic: UsuarioPanel + grilla completa de ese panel",
  );
  const sujeto = await obtenerUsuarioSesion(empleado.id);
  check(
    sujeto !== null &&
      puede(sujeto, COSMETIC, Modulo.VENTAS, "crear") &&
      puede(sujeto, COSMETIC, Modulo.VENTAS, "ver") &&
      !puede(sujeto, COSMETIC, Modulo.PRODUCTOS, "ver"),
    "en Cosmetic: exactamente Ventas (crear ⇒ ver)",
  );
  check(
    sujeto !== null &&
      !accedeAPanel(sujeto, ESPECIALES) &&
      !puede(sujeto, ESPECIALES, Modulo.VENTAS, "ver"),
    "Especiales sigue sin acceso",
  );
  check(
    sujeto !== null &&
      puede(sujeto, VAPES, Modulo.VENTAS, "ver") ===
        original.permisos.some(
          (x) => x.panelId === VAPES && x.modulo === Modulo.VENTAS && x.puedeVer,
        ),
    "los permisos de Vapes no cambiaron",
  );
  const auditoria = await prisma.auditLog.findFirst({
    where: { accion: AccionAuditoria.PERMISO_CAMBIADO, entidadId: empleado.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    auditoria !== null && auditoria.panelId === null,
    "AuditLog PERMISO_CAMBIADO (acción global, sin panel)",
  );
  const restaurado = await actualizarAcceso(actor, aInput(original));
  check(
    (await prisma.permisoUsuario.count({
      where: { usuarioId: empleado.id, panelId: COSMETIC },
    })) === 0 &&
      (await prisma.usuarioPanel.count({
        where: { usuarioId: empleado.id, panelId: COSMETIC },
      })) === 0,
    "quitar un panel borra también sus permisos",
  );
  check(
    JSON.stringify(restaurado.permisos) === JSON.stringify(original.permisos),
    "acceso original restaurado",
  );

  console.log("G) Reglas en la DB (última línea de defensa)");
  await rechaza(
    "dejar el sistema sin OWNER activo (trigger diferido al COMMIT)",
    () =>
      prisma.$transaction(async (tx) => {
        await tx.usuario.updateMany({ where: { rol: RolUsuario.OWNER }, data: { activo: false } });
      }),
    null,
    "Debe quedar al menos un dueño (OWNER) activo",
  );
  check(
    (await prisma.usuario.count({ where: { rol: RolUsuario.OWNER, activo: true } })) >= 1,
    "los dueños siguen activos (rollback)",
  );
  await rechaza(
    "PermisoUsuario crear sin ver (CHECK)",
    () =>
      prisma.$transaction(async (tx) => {
        await tx.permisoUsuario.upsert({
          where: {
            usuarioId_panelId_modulo: {
              usuarioId: empleado.id,
              panelId: VAPES,
              modulo: Modulo.COMPRAS,
            },
          },
          create: {
            usuarioId: empleado.id,
            panelId: VAPES,
            modulo: Modulo.COMPRAS,
            puedeVer: false,
            puedeCrear: true,
          },
          update: { puedeVer: false, puedeCrear: true },
        });
        throw new Rollback();
      }),
    null,
    "PermisoUsuario_ver_chk",
  );
  await rechaza(
    "PermisoUsuario de un módulo global (CHECK)",
    () =>
      prisma.permisoUsuario.create({
        data: {
          usuarioId: empleado.id,
          panelId: VAPES,
          modulo: Modulo.CONFIGURACION,
          puedeVer: true,
        },
      }),
    null,
    "PermisoUsuario_modulo_de_panel_chk",
  );
  await rechaza(
    "PermisoUsuario de un panel inexistente (FK)",
    () =>
      prisma.permisoUsuario.create({
        data: {
          usuarioId: empleado.id,
          panelId: "pnl_no_existe",
          modulo: Modulo.VENTAS,
          puedeVer: true,
        },
      }),
    null,
    "Foreign key constraint",
  );
  await rechaza(
    "IntentoLogin con email en mayúsculas (CHECK)",
    () => prisma.intentoLogin.create({ data: { email: "X@Y.COM", exitoso: false } }),
    null,
    "IntentoLogin_email_chk",
  );
  await rechaza(
    "UPDATE en IntentoLogin (inmutable)",
    () =>
      prisma.$executeRaw`UPDATE "IntentoLogin" SET "exitoso" = true WHERE "email" = ${emailFicticio}`,
    null,
    "inmutable",
  );
  await rechaza(
    "borrar un Usuario (sin DELETE físico)",
    () => prisma.usuario.delete({ where: { id: empleado.id } }),
    null,
    "usá soft delete",
  );

  console.log("H) AuditLog inmutable y sin secretos");
  // La fila se inserta y se intenta modificar en la MISMA transacción: el
  // trigger la aborta, así que el test no deja rastro en un log inmutable.
  for (const op of ["UPDATE", "DELETE"] as const) {
    await rechaza(
      `${op} directo sobre "AuditLog"`,
      () =>
        prisma.$transaction(async (tx) => {
          const fila = await tx.auditLog.create({
            data: { usuarioId: owner.id, accion: AccionAuditoria.UPDATE, entidad: "test-auth" },
          });
          if (op === "UPDATE") {
            await tx.$executeRaw`UPDATE "AuditLog" SET "accion" = 'LOGOUT' WHERE "id" = ${fila.id}`;
          } else {
            await tx.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${fila.id}`;
          }
        }),
      null,
      `La tabla "AuditLog" es inmutable: ${op}`,
    );
  }
  check(
    (await prisma.auditLog.count({ where: { entidad: "test-auth" } })) === 0,
    "no quedó ninguna fila de prueba (rollback)",
  );
  const [{ n: conPassword } = { n: -1n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "AuditLog"
    WHERE COALESCE("datosAntes"::text, '') LIKE '%passwordHash%'
       OR COALESCE("datosDespues"::text, '') LIKE '%passwordHash%'`;
  check(conPassword === 0n, "ninguna fila de AuditLog contiene passwordHash");
  check(!("passwordHash" in snapshotUsuario(owner)), "snapshotUsuario() excluye passwordHash");
  const logins = await prisma.auditLog.count({
    where: { accion: AccionAuditoria.LOGIN, ip: { not: null }, userAgent: { not: null } },
  });
  const loginsTotales = await prisma.auditLog.count({ where: { accion: AccionAuditoria.LOGIN } });
  check(
    logins === loginsTotales,
    `todos los LOGIN registran ip y userAgent (${logins}/${loginsTotales})`,
  );

  console.log("I) Permisos por panel (lógica pura, compartida con la UI)");
  const ownerSujeto = { rol: RolUsuario.OWNER, permisos: [], paneles: [] };
  check(
    Object.values(Modulo).every(
      (m) => puede(ownerSujeto, COSMETIC, m, "eliminar") && puede(ownerSujeto, null, m, "ver"),
    ),
    "OWNER: todo, en todo panel, sin filas de permisos ni paneles",
  );
  const fila = (panelId: string, modulo: Modulo, crear = false) => ({
    panelId,
    modulo,
    puedeVer: true,
    puedeCrear: crear,
    puedeEditar: false,
    puedeEliminar: false,
  });
  const emp = {
    rol: RolUsuario.EMPLEADO,
    paneles: [VAPES],
    permisos: [fila(VAPES, Modulo.VENTAS, true)],
  };
  check(
    puede(emp, VAPES, Modulo.VENTAS, "crear") && !puede(emp, VAPES, Modulo.VENTAS, "editar"),
    "EMPLEADO: exactamente lo habilitado en su panel",
  );
  check(!puede(emp, VAPES, Modulo.STOCK, "ver"), "EMPLEADO: sin fila → sin acceso");
  check(
    !puede(emp, COSMETIC, Modulo.VENTAS, "ver"),
    "EMPLEADO: Ventas en Vapes no habilita Ventas en Cosmetic",
  );
  check(
    !puede(
      { ...emp, permisos: [...emp.permisos, fila(COSMETIC, Modulo.VENTAS)] },
      COSMETIC,
      Modulo.VENTAS,
      "ver",
    ),
    "EMPLEADO: filas de un panel no habilitado no dan acceso",
  );
  check(!puede(emp, null, Modulo.VENTAS, "ver"), "EMPLEADO: sin panel → sin acceso");
  check(
    accedeAPanel(emp, VAPES) && !accedeAPanel(emp, ESPECIALES),
    "accedeAPanel respeta UsuarioPanel",
  );
  check(
    !puede({ ...emp, permisos: [fila(VAPES, Modulo.USUARIOS)] }, VAPES, Modulo.USUARIOS, "ver") &&
      !puede(
        { ...emp, permisos: [fila(VAPES, Modulo.CONFIGURACION)] },
        null,
        Modulo.CONFIGURACION,
        "ver",
      ),
    "USUARIOS y CONFIGURACION son solo de dueños aunque haya una fila (defensa en profundidad)",
  );
  check(
    !MODULOS_DE_PANEL.includes(Modulo.USUARIOS) && !MODULOS_DE_PANEL.includes(Modulo.CONFIGURACION),
    "USUARIOS y CONFIGURACION no aparecen en la grilla de permisos",
  );
  const base = { ...fila(VAPES, Modulo.VENTAS, true), puedeEditar: true };
  const apagarVer = normalizarPermiso({ ...base, puedeVer: false }, "ver");
  check(!apagarVer.puedeCrear && !apagarVer.puedeEditar, "apagar Ver apaga todo");
  const prenderEliminar = normalizarPermiso(
    { ...base, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: true },
    "eliminar",
  );
  check(prenderEliminar.puedeVer, "prender Eliminar prende Ver");
  const dashboard = normalizarPermiso({ ...fila(VAPES, Modulo.DASHBOARD), puedeCrear: true });
  check(!dashboard.puedeCrear && dashboard.puedeVer, "DASHBOARD solo admite «Ver»");

  console.log(
    fallos === 0 ? "\nTODAS LAS PRUEBAS PASARON ✅\n" : `\n${fallos} PRUEBA(S) FALLARON ❌\n`,
  );
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
