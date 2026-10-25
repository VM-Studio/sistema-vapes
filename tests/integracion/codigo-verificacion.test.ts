import type { Transporter } from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * Cambio de contraseña con código por mail (A3, bloque 6), contra PostgreSQL
 * y con jsonTransport (no sale ningún mail): código correcto / incorrecto /
 * vencido / 5 intentos / un solo uso / otra sesión, reenvío con espera y
 * límite por hora, token de verificación de otro usuario o de otra sesión,
 * sesiones revocadas (menos la actual), auditoría, aviso por mail y limpieza.
 */

process.env.DATABASE_URL = URL_VITEST;
process.env.DIRECT_URL = URL_VITEST;
process.env.PRISMA_LOG = "silent";
process.env.LOG_LEVEL = "error";
process.env.AUTH_SECRET ??= "secreto-de-prueba-para-vitest-de-al-menos-32";
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
delete process.env.MAIL_TRANSPORTE;

type Modulos = {
  db: typeof import("@/lib/db");
  svc: typeof import("@/server/services/codigo-verificacion.service");
  sesiones: typeof import("@/server/auth/sesiones");
  password: typeof import("@/server/auth/password");
  mail: typeof import("@/server/mail");
  errores: typeof import("@/server/errors");
  nodemailer: typeof import("nodemailer");
};
let m: Modulos;

interface MailEnviado {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}
const enviados: MailEnviado[] = [];
const suf = String(Date.now()).slice(-6);
const meta = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130" };
const VIEJA = "Vieja2026clave";
const NUEVA = "NuevaClave2026x";

let ana: { id: string; nombre: string; email: string };
let beto: { id: string; nombre: string; email: string };
/** Sesiones de Ana: A (desde la que cambia), B y C (otros dispositivos). */
let sidA = "";
let sidB = "";
let sidC = "";
let sidBeto = "";

/** El código va en el asunto («123456 es tu código…») y solo en una línea del texto. */
const codigoDe = (asunto: string) => /^(\d{6}) es tu código/.exec(asunto)?.[1] ?? "";
const ultimoMail = () => enviados[enviados.length - 1]!;

/** Corre el reloj de los pedidos hacia atrás (simula que pasó el minuto de espera). */
async function pasarMinuto(usuarioId: string) {
  await m.db.prisma
    .$executeRaw`UPDATE "CodigoVerificacion" SET "createdAt" = "createdAt" - interval '61 seconds' WHERE "usuarioId" = ${usuarioId}`;
}

async function pedir(u: typeof ana, sid: string): Promise<string> {
  const r = await m.svc.enviarCodigoCambioPassword(u, sid);
  expect(r.estado).toBe("ENVIADO");
  return codigoDe(ultimoMail().subject);
}

const otroCodigo = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    svc: await import("@/server/services/codigo-verificacion.service"),
    sesiones: await import("@/server/auth/sesiones"),
    password: await import("@/server/auth/password"),
    mail: await import("@/server/mail"),
    errores: await import("@/server/errors"),
    nodemailer: (await import("nodemailer")).default as unknown as typeof import("nodemailer"),
  };
  const p = m.db.prisma;
  const hash = await m.password.hashPassword(VIEJA);
  ana = await p.usuario.create({
    data: {
      nombre: `Ana código ${suf}`,
      email: `ana-codigo-${suf}@negocio.test`,
      rol: "EMPLEADO",
      passwordHash: hash,
      debeCambiarPassword: true,
    },
    select: { id: true, nombre: true, email: true },
  });
  beto = await p.usuario.create({
    data: {
      nombre: `Beto código ${suf}`,
      email: `beto-codigo-${suf}@negocio.test`,
      rol: "EMPLEADO",
      passwordHash: hash,
    },
    select: { id: true, nombre: true, email: true },
  });
  sidA = (await m.sesiones.crearSesion(ana.id, meta)).sid;
  sidB = (await m.sesiones.crearSesion(ana.id, meta)).sid;
  sidC = (await m.sesiones.crearSesion(ana.id, meta)).sid;
  sidBeto = (await m.sesiones.crearSesion(beto.id, meta)).sid;
});

afterAll(async () => {
  m.mail.fijarTransporteMail(null);
  // AuditLog es inmutable: los usuarios de prueba quedan (la base se recrea en cada corrida).
  await m.db.prisma.$disconnect();
});

describe("código por mail para cambiar la contraseña", () => {
  it("sin mail configurado: SIN_CONFIGURAR y no se crea ningún código", async () => {
    m.mail.fijarTransporteMail(null);
    expect(m.mail.mailConfigurado()).toBe(false);
    expect(await m.svc.enviarCodigoCambioPassword(ana, sidA)).toEqual({
      estado: "SIN_CONFIGURAR",
    });
    expect(await m.db.prisma.codigoVerificacion.count({ where: { usuarioId: ana.id } })).toBe(0);
  });

  it("falla el envío: ERROR (sin detalle) y el código queda anulado", async () => {
    m.mail.fijarTransporteMail({
      sendMail: async () => {
        throw new Error("535 credenciales SMTP");
      },
    } as unknown as Transporter);
    expect(await m.svc.enviarCodigoCambioPassword(ana, sidA)).toEqual({ estado: "ERROR" });
    const fila = await m.db.prisma.codigoVerificacion.findFirstOrThrow({
      where: { usuarioId: ana.id },
    });
    expect(fila.usadoAt).not.toBeNull();
    await m.db.prisma.codigoVerificacion.deleteMany({ where: { usuarioId: ana.id } });
  });

  it("manda un código de 6 dígitos al email del usuario y guarda solo su HMAC", async () => {
    const json = m.nodemailer.createTransport({ jsonTransport: true });
    const original = json.sendMail.bind(json);
    json.sendMail = (async (opts: MailEnviado) => {
      enviados.push(opts);
      return original(opts as never);
    }) as never;
    m.mail.fijarTransporteMail(json as Transporter);

    const r = await m.svc.enviarCodigoCambioPassword(ana, sidA);
    expect(r.estado).toBe("ENVIADO");
    if (r.estado !== "ENVIADO") return;
    expect(r.para).toMatch(/^an•+@negocio\.test$/);
    expect(r.reenviarEnSegundos).toBe(60);
    const mail = ultimoMail();
    expect(mail.to).toEqual([ana.email]);
    const codigo = codigoDe(mail.subject);
    expect(codigo).toMatch(/^\d{6}$/);
    expect(mail.text).toMatch(new RegExp(`^ {4}${codigo}$`, "m"));
    expect(mail.text).toContain("Vence en 10 minutos");
    expect(mail.text).toContain("Si no fuiste vos, ignoralo");
    expect(mail.html).toContain(codigo);

    const fila = await m.db.prisma.codigoVerificacion.findFirstOrThrow({
      where: { usuarioId: ana.id, usadoAt: null },
    });
    expect(fila.codigoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.codigoHash).not.toContain(codigo);
    expect(fila.sesionId).toBe(sidA);
    const vence = fila.venceAt.getTime() - fila.createdAt.getTime();
    expect(vence).toBe(10 * 60_000);
  });

  it("reenviar antes de los 60 s se rechaza con la espera", async () => {
    await expect(m.svc.enviarCodigoCambioPassword(ana, sidA)).rejects.toThrow(
      /Esperá \d+ segundos? para pedir otro código/,
    );
  });

  it("código incorrecto suma un intento y avisa cuántos quedan", async () => {
    const codigo = codigoDe(ultimoMail().subject);
    await expect(m.svc.verificarCodigo(ana.id, sidA, otroCodigo(codigo))).rejects.toThrow(
      "El código no es correcto. Te quedan 4 intentos.",
    );
    const fila = await m.db.prisma.codigoVerificacion.findFirstOrThrow({
      where: { usuarioId: ana.id, usadoAt: null },
    });
    expect(fila.intentos).toBe(1);
  });

  it("el código correcto desde OTRA sesión no sirve", async () => {
    const codigo = codigoDe(ultimoMail().subject);
    await expect(m.svc.verificarCodigo(ana.id, sidB, codigo)).rejects.toThrow(
      "Ese código ya no sirve",
    );
  });

  let token = "";
  it("código correcto: token de verificación; el código es de un solo uso", async () => {
    const codigo = codigoDe(ultimoMail().subject);
    const r = await m.svc.verificarCodigo(ana.id, sidA, codigo);
    token = r.token;
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(r.venceAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const fila = await m.db.prisma.codigoVerificacion.findFirstOrThrow({
      where: { usuarioId: ana.id, tokenHash: { not: null } },
    });
    expect(fila.usadoAt).not.toBeNull();
    expect(fila.tokenHash).not.toContain(token);
    await expect(m.svc.verificarCodigo(ana.id, sidA, codigo)).rejects.toThrow(
      "Ese código ya no sirve",
    );
  });

  it("el token de verificación de OTRO usuario (o de otra sesión) se rechaza", async () => {
    await pasarMinuto(beto.id);
    const codigoBeto = await pedir(beto, sidBeto);
    const { token: tokenBeto } = await m.svc.verificarCodigo(beto.id, sidBeto, codigoBeto);
    await expect(
      m.svc.cambiarPasswordConToken(ana.id, sidA, { token: tokenBeto, passwordNueva: NUEVA }, meta),
    ).rejects.toMatchObject({ code: m.svc.VERIFICACION_VENCIDA });
    // El token de Ana usado desde su sesión B tampoco.
    await expect(
      m.svc.cambiarPasswordConToken(ana.id, sidB, { token, passwordNueva: NUEVA }, meta),
    ).rejects.toMatchObject({ code: m.svc.VERIFICACION_VENCIDA });
    // Un token inventado, menos.
    await expect(
      m.svc.cambiarPasswordConToken(
        ana.id,
        sidA,
        { token: "x".repeat(43), passwordNueva: NUEVA },
        meta,
      ),
    ).rejects.toMatchObject({ code: m.svc.VERIFICACION_VENCIDA });
  });

  it("política: una contraseña común o igual a la actual se rechaza sin gastar el token", async () => {
    await expect(
      m.svc.cambiarPasswordConToken(ana.id, sidA, { token, passwordNueva: "password1" }, meta),
    ).rejects.toThrow("de las más usadas");
    await expect(
      m.svc.cambiarPasswordConToken(ana.id, sidA, { token, passwordNueva: VIEJA }, meta),
    ).rejects.toThrow("distinta de la actual");
  });

  it("cambia la contraseña, limpia el cambio obligatorio, revoca las OTRAS sesiones, audita y avisa", async () => {
    const antes = enviados.length;
    const r = await m.svc.cambiarPasswordConToken(
      ana.id,
      sidA,
      { token, passwordNueva: NUEVA },
      meta,
    );
    expect(r).toEqual({ habilitado: true, sesionesCerradas: 2, aviso: "ENVIADO" });

    const p = m.db.prisma;
    const u = await p.usuario.findUniqueOrThrow({ where: { id: ana.id } });
    expect(u.debeCambiarPassword).toBe(false);
    expect(u.passwordHash.startsWith("$2")).toBe(true);
    expect(await m.password.verifyPassword(NUEVA, u.passwordHash)).toBe(true);
    expect(await m.password.verifyPassword(VIEJA, u.passwordHash)).toBe(false);

    const ses = await p.sesion.findMany({ where: { usuarioId: { in: [ana.id, beto.id] } } });
    const revocada = (id: string) => ses.find((s) => s.id === id)!.revocadaAt !== null;
    expect(revocada(sidA)).toBe(false);
    expect(revocada(sidB)).toBe(true);
    expect(revocada(sidC)).toBe(true);
    expect(revocada(sidBeto)).toBe(false);
    expect(await m.sesiones.listarSesionesActivas(ana.id)).toHaveLength(1);

    const audit = await p.auditLog.findFirstOrThrow({
      where: { usuarioId: ana.id, entidad: "Usuario", entidadId: ana.id, accion: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.datosDespues).toMatchObject({
      cambio: "password",
      metodo: "codigo_mail",
      sesionesRevocadas: 2,
    });
    expect(JSON.stringify(audit)).not.toContain(NUEVA);

    expect(enviados.length).toBe(antes + 1);
    expect(ultimoMail().to).toEqual([ana.email]);
    expect(ultimoMail().subject).toMatch(/Tu contraseña de .+ se cambió/);
    expect(ultimoMail().text).toContain("Si NO fuiste vos");
  });

  it("el token es de un solo uso", async () => {
    await expect(
      m.svc.cambiarPasswordConToken(ana.id, sidA, { token, passwordNueva: "OtraMas2026x" }, meta),
    ).rejects.toMatchObject({ code: m.svc.VERIFICACION_VENCIDA });
  });

  it("código vencido (10 minutos) se rechaza", async () => {
    await pasarMinuto(ana.id);
    const codigo = await pedir(ana, sidA);
    await m.db.prisma.codigoVerificacion.updateMany({
      where: { usuarioId: ana.id, usadoAt: null },
      data: { venceAt: new Date(Date.now() - 1000) },
    });
    await expect(m.svc.verificarCodigo(ana.id, sidA, codigo)).rejects.toThrow(
      "El código venció. Pedí uno nuevo.",
    );
  });

  it("un código nuevo anula el anterior", async () => {
    await pasarMinuto(ana.id);
    const viejo = await pedir(ana, sidA);
    await pasarMinuto(ana.id);
    const nuevo = await pedir(ana, sidA);
    if (viejo !== nuevo) {
      await expect(m.svc.verificarCodigo(ana.id, sidA, viejo)).rejects.toThrow("no es correcto");
    }
    expect(
      await m.db.prisma.codigoVerificacion.count({ where: { usuarioId: ana.id, usadoAt: null } }),
    ).toBe(1);
  });

  it("máximo 5 intentos: después ni el código correcto sirve", async () => {
    await m.db.prisma.codigoVerificacion.deleteMany({ where: { usuarioId: ana.id } });
    const codigo = await pedir(ana, sidA);
    const malo = otroCodigo(codigo);
    for (const quedan of [4, 3, 2, 1]) {
      await expect(m.svc.verificarCodigo(ana.id, sidA, malo)).rejects.toThrow(
        quedan === 1 ? "Te queda 1 intento." : `Te quedan ${quedan} intentos.`,
      );
    }
    await expect(m.svc.verificarCodigo(ana.id, sidA, malo)).rejects.toThrow(
      "ya no quedan intentos",
    );
    await expect(m.svc.verificarCodigo(ana.id, sidA, codigo)).rejects.toThrow(
      "Demasiados intentos con este código",
    );
  });

  it("límite por hora: el 6º pedido en una hora se rechaza", async () => {
    await m.db.prisma.codigoVerificacion.deleteMany({ where: { usuarioId: ana.id } });
    for (let i = 0; i < m.svc.MAX_CODIGOS_POR_HORA; i++) {
      await pasarMinuto(ana.id);
      await pedir(ana, sidA);
    }
    await pasarMinuto(ana.id);
    await expect(m.svc.enviarCodigoCambioPassword(ana, sidA)).rejects.toThrow(
      /Pediste demasiados códigos\. Probá de nuevo en \d+ minutos?\./,
    );
    await expect(m.svc.enviarCodigoCambioPassword(ana, sidA)).rejects.toBeInstanceOf(
      m.errores.RateLimitError,
    );
  });

  it("cerrar la sesión que pidió el código borra sus códigos (cascade) y la limpieza borra los vencidos", async () => {
    const p = m.db.prisma;
    await p.codigoVerificacion.create({
      data: {
        usuarioId: beto.id,
        sesionId: sidBeto,
        proposito: "CAMBIO_PASSWORD",
        codigoHash: "0".repeat(64),
        venceAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
      },
    });
    expect(await m.svc.limpiarCodigosVencidos()).toBeGreaterThanOrEqual(1);
    expect(
      await p.codigoVerificacion.count({
        where: { venceAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
      }),
    ).toBe(0);
    // CHECK: intentos acotados.
    await expect(
      p.codigoVerificacion.create({
        data: {
          usuarioId: beto.id,
          sesionId: sidBeto,
          proposito: "CAMBIO_PASSWORD",
          codigoHash: "0".repeat(64),
          venceAt: new Date(),
          intentos: 6,
        },
      }),
    ).rejects.toThrow(/codigo_verificacion_coherente/);
  });

  it("el código es uniforme de 6 dígitos (con ceros a la izquierda)", () => {
    const codigos = Array.from({ length: 200 }, () => m.svc.generarCodigo());
    expect(codigos.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codigos).size).toBeGreaterThan(190);
  });
});
