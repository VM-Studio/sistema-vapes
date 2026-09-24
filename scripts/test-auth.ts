/**
 * Pruebas de la capa de auth/permisos a nivel servicio + DB.
 * Uso: pnpm test:auth   (requiere migraciones + seed; lee AUTH_SECRET de .env)
 *
 * No deja datos de negocio: las reglas se prueban con operaciones que fallan
 * o dentro de transacciones que terminan en rollback. Solo quedan filas en
 * IntentoLogin del email ficticio usado para probar el login.
 */
import { AccionAuditoria, Modulo, RolUsuario } from "@prisma/client";
import { SignJWT } from "jose";

import { prisma, withTransaction } from "../src/lib/db";
import { MODULOS_ASIGNABLES, normalizarPermiso, puede } from "../src/lib/permisos";
import { generarPasswordTemporal, validarFortaleza } from "../src/server/auth/password";
import {
  crearToken,
  debeRenovar,
  DURACION_SESION_S,
  verificarToken,
} from "../src/server/auth/session";
import { DomainError, UnauthorizedError, ConflictError } from "../src/server/errors";
import { snapshotUsuario } from "../src/server/services/audit.service";
import { autenticar } from "../src/server/services/auth.service";
import {
  actualizarPermisos,
  actualizarUsuario,
  crearUsuario,
  darDeBajaUsuario,
  resetearPassword,
} from "../src/server/services/usuario.service";

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
  const owner = await prisma.usuario.findFirstOrThrow({ where: { email: "dueno1@negocio.com" } });
  const empleado = await prisma.usuario.findFirstOrThrow({
    where: { email: "empleado@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-auth" } };

  console.log("\nA) Sesión (JWT HS256)");
  const token = await crearToken({ id: owner.id, rol: RolUsuario.OWNER });
  const payload = await verificarToken(token);
  check(payload?.sub === owner.id && payload.rol === "OWNER", "token válido: sub + rol");
  check(
    payload !== null &&
      Object.keys(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()))
        .sort()
        .join() === "exp,iat,rol,sub",
    "payload solo trae sub, rol, iat, exp (sin permisos)",
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
    !debeRenovar({ sub: "x", rol: "OWNER", iat: ahora, exp: ahora + 5 * 86400 }),
    "faltan 5 días → no renueva",
  );
  check(
    debeRenovar({ sub: "x", rol: "OWNER", iat: ahora, exp: ahora + 2 * 86400 }),
    "faltan 2 días (<3) → renueva",
  );

  console.log("B) Contraseñas");
  check(validarFortaleza("clave1234").ok, '"clave1234" válida (letra + número, 8+)');
  check(!validarFortaleza("clave12").ok, "7 caracteres → inválida");
  check(!validarFortaleza("solamenteletras").ok, "sin número → inválida");
  check(!validarFortaleza("1234567890").ok, "sin letra → inválida");
  const temporales = Array.from({ length: 500 }, () => generarPasswordTemporal());
  check(
    temporales.every((t) => t.length === 12 && validarFortaleza(t).ok && !/[0O1lI]/.test(t)),
    "500 temporales: 12 caracteres, cumplen la política, sin caracteres ambiguos",
  );
  check(new Set(temporales).size === 500, "500 temporales distintas");

  console.log("C) Login (servicio)");
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

  console.log("D) Reglas de dueños (servicio)");
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
        email: "dueno2@negocio.com",
        rol: RolUsuario.EMPLEADO,
        password: "clave1234",
      }),
    ConflictError,
    "Ya existe un usuario con ese email",
  );
  await rechaza(
    "asignar permisos a un OWNER",
    () => actualizarPermisos(actor, { usuarioId: owner.id, permisos: [] }),
    DomainError,
    "acceso total",
  );

  console.log("E) Reglas en la DB (última línea de defensa)");
  await rechaza(
    "dejar el sistema sin OWNER activo (trigger diferido al COMMIT)",
    () =>
      withTransaction(async (tx) => {
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
      withTransaction(async (tx) => {
        await tx.permisoUsuario.upsert({
          where: { usuarioId_modulo: { usuarioId: empleado.id, modulo: Modulo.COMPRAS } },
          create: {
            usuarioId: empleado.id,
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

  console.log("F) Verificación 5 del spec: AuditLog sigue siendo inmutable");
  // La fila se inserta y se intenta modificar en la MISMA transacción: el
  // trigger la aborta, así que el test no deja rastro en un log inmutable.
  for (const op of ["UPDATE", "DELETE"] as const) {
    await rechaza(
      `${op} directo sobre "AuditLog"`,
      () =>
        withTransaction(async (tx) => {
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
  const acciones = await prisma.auditLog.groupBy({ by: ["accion"], _count: true });
  console.log(
    `     AuditLog por acción: ${acciones.map((a) => `${a.accion}=${a._count}`).join(", ") || "(vacío)"}`,
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

  console.log("G) Permisos (lógica pura, compartida con la UI)");
  const ownerSujeto = { rol: RolUsuario.OWNER, permisos: [] };
  check(
    Object.values(Modulo).every((m) => puede(ownerSujeto, m, "eliminar")),
    "OWNER: todo, sin filas de permisos",
  );
  const emp = {
    rol: RolUsuario.EMPLEADO,
    permisos: [
      {
        modulo: Modulo.VENTAS,
        puedeVer: true,
        puedeCrear: true,
        puedeEditar: false,
        puedeEliminar: false,
      },
    ],
  };
  check(
    puede(emp, Modulo.VENTAS, "crear") && !puede(emp, Modulo.VENTAS, "editar"),
    "EMPLEADO: exactamente lo habilitado",
  );
  check(!puede(emp, Modulo.INVENTARIO, "ver"), "EMPLEADO: sin fila → sin acceso");
  check(
    !puede(
      {
        rol: RolUsuario.EMPLEADO,
        permisos: [
          {
            modulo: Modulo.USUARIOS,
            puedeVer: true,
            puedeCrear: true,
            puedeEditar: true,
            puedeEliminar: true,
          },
        ],
      },
      Modulo.USUARIOS,
      "ver",
    ),
    "USUARIOS es solo de dueños aunque haya una fila (defensa en profundidad)",
  );
  check(
    !MODULOS_ASIGNABLES.includes(Modulo.USUARIOS),
    "USUARIOS no aparece en la grilla de permisos",
  );
  const base = {
    modulo: Modulo.VENTAS,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: true,
    puedeEliminar: false,
  };
  const apagarVer = normalizarPermiso({ ...base, puedeVer: false }, "ver");
  check(!apagarVer.puedeCrear && !apagarVer.puedeEditar, "apagar Ver apaga todo");
  const prenderEliminar = normalizarPermiso(
    { ...base, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: true },
    "eliminar",
  );
  check(prenderEliminar.puedeVer, "prender Eliminar prende Ver");

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
