import { tmpdir } from "node:os";
import path from "node:path";

import type { Transporter } from "nodemailer";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * Pago de la liquidación con remito firmado (A3, bloque 2), contra
 * PostgreSQL y con un transporte de prueba de nodemailer (jsonTransport): no
 * sale ningún mail. Token válido / vencido / usado / reemplazado, estados
 * PENDIENTE → PAGADA → FIRMADA, PDF con las dos firmas, a quién va cada mail,
 * "sin configurar" y la inmutabilidad de firmas y envíos.
 */

process.env.DATABASE_URL = URL_VITEST;
process.env.DIRECT_URL = URL_VITEST;
process.env.PRISMA_LOG = "silent";
process.env.LOG_LEVEL = "warn";
process.env.AUTH_SECRET ??= "secreto-de-prueba-para-vitest-de-al-menos-32";
process.env.NEXT_PUBLIC_APP_URL = "https://gestion.test";
process.env.MAIL_DUENOS = "duenos@negocio.test, socia@negocio.test";
// Caché de PDFs en una carpeta temporal (no ensucia el repo).
process.env.STORAGE_DIR = path.join(tmpdir(), `remito-vitest-${process.pid}`);
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
delete process.env.MAIL_TRANSPORTE;

const VAPES = "pnl_vapes";

type Modulos = {
  db: typeof import("@/lib/db");
  scoped: typeof import("@/server/db/panel-scoped");
  ventas: typeof import("@/server/services/venta.service");
  clientes: typeof import("@/server/services/cliente.service");
  movimientos: typeof import("@/server/services/movimiento.service");
  ganancia: typeof import("@/server/services/ganancia-vendedor.service");
  remito: typeof import("@/server/services/remito-liquidacion.service");
  mail: typeof import("@/server/mail");
  lib: typeof import("@/lib/ganancia-vendedor");
  reloj: typeof import("@/lib/reloj");
  vVenta: typeof import("@/lib/validations/venta");
  errores: typeof import("@/server/errors");
  nodemailer: typeof import("nodemailer");
};
let m: Modulos;
let owner: { id: string; nombre: string; email: string };
let vendedor: { id: string; nombre: string; email: string };
let otroId: string;
let liqA: string;
let liqB: string;
let firmaPng: string;
let token = "";
const suf = String(Date.now()).slice(-6);

interface MailEnviado {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer | string; encoding?: BufferEncoding }[];
}
const enviados: MailEnviado[] = [];

const ctxDe = (usuarioId: string) => ({
  panelId: VAPES,
  usuarioId,
  meta: { ip: "203.0.113.7", userAgent: "vitest-remito" },
});
const pago = () => ({ monto: 4500, medioPago: "EFECTIVO" as const, fecha: new Date() });
/** jsonTransport deja el adjunto en base64 (string); lo leemos igual. */
const bytesAdjunto = (a?: { content: Buffer | string; encoding?: BufferEncoding }) =>
  !a
    ? Buffer.alloc(0)
    : Buffer.isBuffer(a.content)
      ? a.content
      : Buffer.from(a.content, a.encoding ?? "base64");
const tokenDe = (texto: string) => /\/firma\/([A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? "";

async function png(svg: string): Promise<string> {
  const b = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${b.toString("base64")}`;
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    ventas: await import("@/server/services/venta.service"),
    clientes: await import("@/server/services/cliente.service"),
    movimientos: await import("@/server/services/movimiento.service"),
    ganancia: await import("@/server/services/ganancia-vendedor.service"),
    remito: await import("@/server/services/remito-liquidacion.service"),
    mail: await import("@/server/mail"),
    lib: await import("@/lib/ganancia-vendedor"),
    reloj: await import("@/lib/reloj"),
    vVenta: await import("@/lib/validations/venta"),
    errores: await import("@/server/errors"),
    nodemailer: (await import("nodemailer")).default as unknown as typeof import("nodemailer"),
  };
  // Transporte de prueba: jsonTransport (no sale nada) + registro de lo "enviado".
  const json = m.nodemailer.createTransport({ jsonTransport: true });
  const original = json.sendMail.bind(json);
  json.sendMail = (async (opts: MailEnviado) => {
    enviados.push(opts);
    return original(opts as never);
  }) as never;
  m.mail.fijarTransporteMail(json as Transporter);

  const p = m.db.prisma;
  owner = await p.usuario.findFirstOrThrow({
    where: { rol: "OWNER" },
    select: { id: true, nombre: true, email: true },
  });
  vendedor = await p.usuario.create({
    data: {
      nombre: `Vendedora remito ${suf}`,
      email: `remito-${suf}@negocio.test`,
      rol: "EMPLEADO",
      passwordHash: "x",
      paneles: { create: [{ panelId: VAPES }] },
    },
    select: { id: true, nombre: true, email: true },
  });
  otroId = (
    await p.usuario.create({
      data: {
        nombre: `Otro ${suf}`,
        email: `otro-${suf}@negocio.test`,
        rol: "EMPLEADO",
        passwordHash: "x",
        paneles: { create: [{ panelId: VAPES }] },
      },
    })
  ).id;
  await m.ganancia.guardarTarifas(ctxDe(owner.id), vendedor.id, {
    minorista: 1500,
    mayorista: 300,
    minoristaNuevo: 2000,
    mayoristaNuevo: 500,
  });
  const db = m.scoped.dbPara(VAPES);
  const depositoId = (await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } })).id;
  const variante = await m.scoped.transaccion(ctxDe(owner.id), async (tx) => {
    const marca = await tx.marca.create({ data: { nombre: `Remito ${suf}` } });
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod R ${suf}`,
        especificacion: "8000",
        precioVenta: "8000.00",
        variantes: { create: [{ nombre: "Menta", sku: `RM-${suf}`, ultimoCosto: "4000.00" }] },
      },
      include: { variantes: true },
    });
    return producto.variantes[0]!;
  });
  await m.movimientos.registrarAjuste(ctxDe(owner.id), {
    depositoId,
    varianteId: variante.id,
    cantidadReal: 100,
    motivo: "Preparación vitest remito",
  });
  const cliente = await m.clientes.crearCliente(ctxDe(owner.id), {
    nombre: `Cliente remito ${suf}`,
    telefono: `11${suf.slice(-4)}7777`,
  });
  const mesC = m.ganancia.mesActual();
  const mesA = m.lib.sumarMeses(mesC, -2);
  const mesB = m.lib.sumarMeses(mesC, -1);
  for (const mes of [mesA, mesB]) {
    m.reloj.fijarReloj(() => new Date(`${mes}-12T15:00:00.000Z`));
    await m.ventas.generarVenta(
      ctxDe(vendedor.id),
      m.vVenta.generarVentaSchema.parse({
        depositoId,
        cliente: { id: cliente.id },
        tipo: "UNITARIA",
        items: [{ varianteId: variante.id, cantidad: 3 }],
        pagos: [{ medioPago: "EFECTIVO", monto: 24000 }],
      }),
      { puedeEditar: false },
    );
    m.reloj.fijarReloj(null);
  }
  liqA = (await m.ganancia.generarLiquidacion(ctxDe(owner.id), vendedor.id, mesA)).id;
  liqB = (await m.ganancia.generarLiquidacion(ctxDe(owner.id), vendedor.id, mesB)).id;
  firmaPng = await png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150"><path d="M20 120 C 80 10, 160 140, 380 30" stroke="#594A42" stroke-width="4" fill="none"/></svg>`,
  );
});

afterAll(async () => {
  m.mail.fijarTransporteMail(null);
  m.reloj.fijarReloj(null);
  await m.db.prisma.$disconnect();
});

describe("firma dibujada", () => {
  it("rechaza la firma vacía y lo que no es PNG", async () => {
    const vacia = await png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"></svg>`,
    );
    await expect(m.remito.procesarFirma(vacia)).rejects.toBeInstanceOf(m.errores.ValidationError);
    await expect(m.remito.procesarFirma("data:image/png;base64,AAAA")).rejects.toBeInstanceOf(
      m.errores.ValidationError,
    );
    await expect(m.remito.procesarFirma("hola")).rejects.toBeInstanceOf(m.errores.ValidationError);
    const ok = await m.remito.procesarFirma(firmaPng);
    expect(Buffer.from(ok).subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("pago con firma del dueño", () => {
  it("solo un dueño registra el pago; queda PAGADA con su firma y le llega el remito al vendedor", async () => {
    await expect(
      m.remito.registrarPagoConFirma(ctxDe(vendedor.id), liqA, pago(), firmaPng),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
    const r = await m.remito.registrarPagoConFirma(ctxDe(owner.id), liqA, pago(), firmaPng);
    expect(r.envio).toMatchObject({ estado: "ENVIADO", para: [vendedor.email] });
    token = tokenDe(r.link);
    expect(token).toHaveLength(43);
    expect(r.link).toBe(`https://gestion.test/firma/${token}`);

    const mail = enviados.at(-1)!;
    expect(mail.to).toEqual([vendedor.email]);
    expect(mail.replyTo).toBe(owner.email);
    expect(mail.subject).toContain(`firmado por ${owner.nombre}`);
    expect(mail.text).toContain(`FIRMADO POR ${owner.nombre.toUpperCase()}`);
    expect(mail.text).toContain(`Firmó y envió: ${owner.nombre} (dueño)`);
    expect(tokenDe(mail.text)).toBe(token);
    expect(bytesAdjunto(mail.attachments?.[0]).subarray(0, 5).toString()).toBe("%PDF-");

    const db = m.scoped.dbPara(VAPES);
    const l = await db.liquidacionVendedor.findUniqueOrThrow({ where: { id: liqA } });
    expect(l.estado).toBe("PAGADA");
    // En la base solo el hash del token.
    expect(l.firmaTokenHash).toBe(m.remito.hashToken(token));
    expect(l.firmaTokenHash).not.toContain(token);
    const firmas = await db.firmaRemito.findMany({ where: { liquidacionId: liqA } });
    expect(firmas.map((f) => [f.rol, f.usuarioId])).toEqual([["DUENO", owner.id]]);
    const envios = await db.envioRemito.findMany({ where: { liquidacionId: liqA } });
    expect(envios).toHaveLength(1);
    expect(envios[0]).toMatchObject({
      tipo: "PARA_FIRMAR",
      resultado: "ENVIADO",
      enviadoPorId: owner.id,
    });
  });

  it("no se paga dos veces", async () => {
    await expect(
      m.remito.registrarPagoConFirma(ctxDe(owner.id), liqA, pago(), firmaPng),
    ).rejects.toBeInstanceOf(m.errores.DomainError);
  });
});

describe("token de firma", () => {
  it("válido; uno inventado o mal formado es inválido", async () => {
    expect((await m.remito.estadoToken(token)).estado).toBe("VALIDO");
    expect((await m.remito.estadoToken(m.remito.nuevoToken().token)).estado).toBe("INVALIDO");
    expect((await m.remito.estadoToken("../../etc")).estado).toBe("INVALIDO");
  });

  it("vencido: no deja firmar; reenviar da un link nuevo y el viejo deja de servir", async () => {
    const db = m.scoped.dbPara(VAPES);
    await db.liquidacionVendedor.update({
      where: { id: liqA },
      data: { firmaTokenVenceAt: new Date(Date.now() - 60_000) },
    });
    expect((await m.remito.estadoToken(token)).estado).toBe("VENCIDO");
    await expect(m.remito.firmarConToken(token, firmaPng, undefined)).rejects.toThrow(/venció/);
    const r = await m.remito.reenviarRemito(ctxDe(owner.id), liqA);
    const nuevo = tokenDe(r.link!);
    expect(nuevo).not.toBe(token);
    expect((await m.remito.estadoToken(token)).estado).toBe("INVALIDO");
    expect((await m.remito.estadoToken(nuevo)).estado).toBe("VALIDO");
    token = nuevo;
  });

  it("el vendedor firma por el link: FIRMADA con las dos firmas y el remito va a los dueños", async () => {
    const meta = { ip: "198.51.100.23", userAgent: "Mozilla/5.0 (iPhone)" };
    const r = await m.remito.firmarConToken(token, firmaPng, meta);
    expect(r.envio).toMatchObject({
      estado: "ENVIADO",
      para: ["duenos@negocio.test", "socia@negocio.test"],
    });
    const mail = enviados.at(-1)!;
    expect(mail.subject).toBe(
      `${vendedor.nombre} firmó el remito de pago de ${m.lib.nombreMes(m.lib.sumarMeses(m.ganancia.mesActual(), -2))}`,
    );
    expect(mail.text).toContain(`Firma del dueño: ${owner.nombre}`);
    expect(mail.attachments?.[0]?.filename).toMatch(/^remito-VAP-R-\d{6}-/);

    const db = m.scoped.dbPara(VAPES);
    const l = await db.liquidacionVendedor.findUniqueOrThrow({ where: { id: liqA } });
    expect(l.estado).toBe("FIRMADA");
    expect(l.firmadaAt).not.toBeNull();
    expect(l.firmaTokenUsadoAt).not.toBeNull();
    const fv = await db.firmaRemito.findFirstOrThrow({
      where: { liquidacionId: liqA, rol: "VENDEDOR" },
    });
    expect(fv).toMatchObject({
      usuarioId: vendedor.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      medio: "link",
    });

    const remito = await m.remito.obtenerRemito(ctxDe(owner.id), liqA);
    expect(remito?.firmaDueno?.nombre).toBe(owner.nombre);
    expect(remito?.firmaVendedor?.nombre).toBe(vendedor.nombre);
    expect(remito?.envios.map((e) => e.tipo)).toEqual(["FIRMADO", "PARA_FIRMAR", "PARA_FIRMAR"]);
  });

  it("usado: no se firma dos veces", async () => {
    expect((await m.remito.estadoToken(token)).estado).toBe("USADO");
    await expect(m.remito.firmarConToken(token, firmaPng, undefined)).rejects.toBeInstanceOf(
      m.errores.DomainError,
    );
  });
});

describe("PDF, sin mail e inmutabilidad", () => {
  it("el PDF del remito se genera con las dos firmas", async () => {
    const { pdf, archivo, remito } = await m.remito.pdfRemito(VAPES, liqA);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(archivo).toBe(`remito-${remito.numero}.pdf`);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe(`Remito ${remito.numero}`);
  });

  it("sin mail configurado: se registra «sin configurar» y el link sigue sirviendo", async () => {
    m.mail.fijarTransporteMail(null);
    try {
      const r = await m.remito.registrarPagoConFirma(ctxDe(owner.id), liqB, pago(), firmaPng);
      expect(r.envio.estado).toBe("SIN_CONFIGURAR");
      expect(r.mailConfigurado).toBe(false);
      const e = await m.scoped
        .dbPara(VAPES)
        .envioRemito.findFirstOrThrow({ where: { liquidacionId: liqB } });
      expect(e).toMatchObject({ resultado: "SIN_CONFIGURAR", detalle: "mail sin configurar" });
      expect((await m.remito.estadoToken(tokenDe(r.link))).estado).toBe("VALIDO");
    } finally {
      const json = m.nodemailer.createTransport({ jsonTransport: true });
      m.mail.fijarTransporteMail(json);
    }
  });

  it("logueado firma solo el vendedor de la liquidación", async () => {
    await expect(m.remito.firmarDesdeSesion(ctxDe(otroId), liqB, firmaPng)).rejects.toBeInstanceOf(
      m.errores.ForbiddenError,
    );
    await m.remito.firmarDesdeSesion(ctxDe(vendedor.id), liqB, firmaPng);
    const f = await m.scoped
      .dbPara(VAPES)
      .firmaRemito.findFirstOrThrow({ where: { liquidacionId: liqB, rol: "VENDEDOR" } });
    expect(f.medio).toBe("sesion");
    expect(await m.remito.remitosParaFirmar(ctxDe(vendedor.id))).toEqual([]);
  });

  it("firmas, envíos y la liquidación firmada no se tocan", async () => {
    const db = m.scoped.dbPara(VAPES);
    const f = await db.firmaRemito.findFirstOrThrow({ where: { liquidacionId: liqA } });
    await expect(
      db.firmaRemito.update({ where: { id: f.id }, data: { nombre: "Otro" } }),
    ).rejects.toThrow(/inmutable/);
    await expect(db.firmaRemito.delete({ where: { id: f.id } })).rejects.toThrow(/inmutable/);
    const e = await db.envioRemito.findFirstOrThrow({ where: { liquidacionId: liqA } });
    await expect(db.envioRemito.delete({ where: { id: e.id } })).rejects.toThrow(/inmutable/);
    await expect(
      db.liquidacionVendedor.update({ where: { id: liqA }, data: { estado: "PAGADA" } }),
    ).rejects.toThrow(/firmada|pagada/);
  });
});
