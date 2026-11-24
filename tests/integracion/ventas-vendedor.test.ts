import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * "Ventas de {vendedor}" (A2, bloque 10), contra PostgreSQL real:
 *  1. Un cliente dado de alta en una venta queda con creadoPorId = vendedor y
 *     creadoEnVentaId = la venta; la venta, con clienteNuevo = true.
 *  2. El alta desde Clientes deja creadoPorId (sin venta de alta); venderle
 *     después NO es "venta a cliente nuevo".
 *  3. Convertir una cotización de alguien que no era cliente también es venta
 *     a cliente nuevo.
 *  4. ventasDeVendedor: ventas, unidades, clientes nuevos cargados, ventas a
 *     clientes nuevos, unitarias vs. mayoristas, serie y lista con "Nuevo".
 *     Solo dueños.
 *  5. clienteNuevo es inmutable (trigger) y la venta de alta tiene que ser del cliente.
 *  6. «¿De quién viene?» (v2.13.0): obligatorio al dar de alta; si el cliente
 *     viene de Trinidad, todas sus ventas a ese cliente ganan la tarifa de
 *     cliente nuevo aunque contestara «No»; si viene de un dueño, no. Los
 *     dueños completan el de los clientes viejos y el mes abierto se recalcula.
 */

process.env.DATABASE_URL = URL_VITEST;
process.env.DIRECT_URL = URL_VITEST;
process.env.PRISMA_LOG = "silent";
process.env.LOG_LEVEL = "warn";

const VAPES = "pnl_vapes";

type Modulos = {
  db: typeof import("@/lib/db");
  scoped: typeof import("@/server/db/panel-scoped");
  ventas: typeof import("@/server/services/venta.service");
  clientes: typeof import("@/server/services/cliente.service");
  ganancia: typeof import("@/server/services/ganancia-vendedor.service");
  cotizaciones: typeof import("@/server/services/cotizacion.service");
  analitica: typeof import("@/server/services/analitica.service");
  movimientos: typeof import("@/server/services/movimiento.service");
  validaciones: typeof import("@/lib/validations/venta");
  errores: typeof import("@/server/errors");
};
let m: Modulos;
let ownerId: string;
let trinidadId: string;
let depositoId: string;
let varianteId: string;
/** Lo de Trinidad hoy antes de este archivo (otros tests de integración pueden haberle cargado ventas). */
let antes: Awaited<ReturnType<Modulos["analitica"]["ventasDeVendedor"]>>;
const suf = String(Date.now()).slice(-6);
let tel = 0;
const telefono = () => `11${suf.slice(-4)}${String(2000 + tel++)}`;

const ctxDe = (usuarioId: string) => ({
  panelId: VAPES,
  usuarioId,
  meta: { ip: "127.0.0.1", userAgent: "vitest-ventas-vendedor" },
});

function vender(
  usuarioId: string,
  cliente: { id: string } | { nuevo: { nombre: string; telefono: string; origenId: string } },
  cantidad: number,
  tipo: "UNITARIA" | "MAYORISTA" = "UNITARIA",
) {
  return m.ventas.generarVenta(
    ctxDe(usuarioId),
    m.validaciones.generarVentaSchema.parse({
      depositoId,
      cliente,
      tipo,
      items: [{ varianteId, cantidad }],
      pagos: [{ medioPago: "EFECTIVO", monto: 8000 * cantidad }],
    }),
    { puedeEditar: false },
  );
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    ventas: await import("@/server/services/venta.service"),
    clientes: await import("@/server/services/cliente.service"),
    ganancia: await import("@/server/services/ganancia-vendedor.service"),
    cotizaciones: await import("@/server/services/cotizacion.service"),
    analitica: await import("@/server/services/analitica.service"),
    movimientos: await import("@/server/services/movimiento.service"),
    validaciones: await import("@/lib/validations/venta"),
    errores: await import("@/server/errors"),
  };
  const p = m.db.prisma;
  ownerId = (await p.usuario.findFirstOrThrow({ where: { rol: "OWNER" } })).id;
  trinidadId = (await p.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } })).id;
  const db = m.scoped.dbPara(VAPES);
  depositoId = (await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } })).id;
  const variante = await m.scoped.transaccion(ctxDe(ownerId), async (tx) => {
    const marca = await tx.marca.create({ data: { nombre: `Vendedor ${suf}` } });
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod ${suf}`,
        especificacion: "8000",
        precioVenta: "8000.00",
        variantes: { create: [{ nombre: "Mango", sku: `VV-${suf}`, ultimoCostoUsdt: "2.50" }] },
      },
      include: { variantes: true },
    });
    return producto.variantes[0]!;
  });
  varianteId = variante.id;
  await m.movimientos.registrarAjuste(ctxDe(ownerId), {
    depositoId,
    varianteId,
    cantidadReal: 500,
    motivo: "Preparación vitest ventas-vendedor",
  });
  antes = await m.analitica.ventasDeVendedor(
    ctxDe(ownerId),
    trinidadId,
    m.analitica.periodoDesdeParams({}),
  );
});

afterAll(async () => {
  await m.db.prisma.$disconnect();
});

describe("clientes nuevos bien registrados", () => {
  it("el cliente dado de alta en la venta queda con su vendedor y su venta de alta", async () => {
    const v = await vender(
      trinidadId,
      { nuevo: { nombre: "Nuevo de Tri", telefono: telefono(), origenId: ownerId } },
      3,
    );
    expect(v.clienteNuevo).toBe(true);
    const db = m.scoped.dbPara(VAPES);
    const venta = await db.venta.findUniqueOrThrow({ where: { id: v.id } });
    expect(venta).toMatchObject({ clienteNuevo: true, vendedorId: trinidadId });
    const cliente = await db.cliente.findUniqueOrThrow({ where: { id: v.cliente.id } });
    expect(cliente).toMatchObject({ creadoPorId: trinidadId, creadoEnVentaId: v.id });
  });

  it("el alta desde Clientes guarda quién lo cargó; venderle después no es venta a cliente nuevo", async () => {
    const c = await m.clientes.crearCliente(ctxDe(trinidadId), {
      nombre: "Cargado en Clientes",
      telefono: telefono(),
      origenId: ownerId,
    });
    const db = m.scoped.dbPara(VAPES);
    expect(await db.cliente.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      creadoPorId: trinidadId,
      creadoEnVentaId: null,
    });
    const v = await vender(trinidadId, { id: c.id }, 2, "MAYORISTA");
    expect(v.clienteNuevo).toBe(false);
    expect((await db.venta.findUniqueOrThrow({ where: { id: v.id } })).clienteNuevo).toBe(false);
  });

  it("convertir la cotización de alguien que no era cliente es venta a cliente nuevo", async () => {
    const ctx = ctxDe(ownerId);
    const cot = await m.cotizaciones.crearCotizacion(
      ctx,
      {
        tipo: "UNITARIA",
        cliente: { nombre: "Cotizado sin ficha", telefono: telefono(), origenId: ownerId },
        items: [{ varianteId, cantidad: 1 }],
      },
      { puedeEditar: true },
    );
    const v = await m.cotizaciones.convertirEnVenta(ctx, cot.id, {
      depositoId,
      pagos: [{ medioPago: "EFECTIVO", monto: 8000 }],
    });
    expect(v.clienteNuevo).toBe(true);
    const db = m.scoped.dbPara(VAPES);
    expect(await db.cliente.findUniqueOrThrow({ where: { id: v.cliente.id } })).toMatchObject({
      creadoPorId: ownerId,
      creadoEnVentaId: v.id,
    });
  });
});

describe("ventasDeVendedor", () => {
  it("resume ventas, unidades, clientes nuevos y ventas a clientes nuevos del período", async () => {
    const hoy = m.analitica.periodoDesdeParams({});
    const d = await m.analitica.ventasDeVendedor(ctxDe(ownerId), trinidadId, hoy);
    // Las dos de arriba: 3 u. a un cliente nuevo (unitaria) y 2 u. mayorista a uno cargado en Clientes.
    const a = antes.actual;
    expect(d.usuario.id).toBe(trinidadId);
    expect(d.actual.cantidadVentas - a.cantidadVentas).toBe(2);
    expect(d.actual.unidades - a.unidades).toBe(5);
    expect(d.actual.clientesNuevos - a.clientesNuevos).toBe(2);
    expect(d.actual.ventasAClientesNuevos - a.ventasAClientesNuevos).toBe(1);
    expect(d.ventasAClientesNuevos.actual).toBe(d.actual.ventasAClientesNuevos);
    expect(d.actual.unitarias.cantidad - a.unitarias.cantidad).toBe(1);
    expect(Number(d.actual.unitarias.total.pesos) - Number(a.unitarias.total.pesos)).toBe(24000);
    expect(d.actual.mayoristas.cantidad - a.mayoristas.cantidad).toBe(1);
    // USDT: la suma de cada venta a su cotización; unitarias + mayoristas = facturado, al centavo.
    expect(Math.round(Number(d.actual.facturado.usdt) * 100)).toBe(
      Math.round(Number(d.actual.unitarias.total.usdt) * 100) +
        Math.round(Number(d.actual.mayoristas.total.usdt) * 100),
    );
    expect(d.ventas.total - antes.ventas.total).toBe(2);
    // Las más nuevas primero: la mayorista (cliente de Clientes) y la del cliente nuevo.
    expect(d.ventas.filas.slice(0, 2).map((f) => f.clienteNuevo)).toEqual([false, true]);
    expect(d.ventas.filas.slice(0, 2).every((f) => f.estadoPago === "PAGADA")).toBe(true);
    expect(d.serie.length).toBe(24);
    expect(Math.round(d.serie.reduce((a, p) => a + (p.actual ?? 0), 0) * 100)).toBe(
      Math.round(Number(d.actual.facturado.usdt) * 100),
    );
  });

  it("es solo para dueños", async () => {
    const hoy = m.analitica.periodoDesdeParams({});
    await expect(
      m.analitica.ventasDeVendedor(ctxDe(trinidadId), trinidadId, hoy),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
  });

  it("vendedoresDestacados lista a los empleados que venden (Trinidad), no a los dueños", async () => {
    const vs = await m.analitica.vendedoresDestacados(ctxDe(ownerId));
    expect(vs.map((v) => v.id)).toContain(trinidadId);
    expect(vs.map((v) => v.id)).not.toContain(ownerId);
  });
});

describe("integridad en la base", () => {
  it("clienteNuevo no se modifica y la venta de alta tiene que ser del cliente", async () => {
    const v = await vender(
      ownerId,
      { nuevo: { nombre: "Inmutable", telefono: telefono(), origenId: ownerId } },
      1,
    );
    const p = m.db.prisma;
    await expect(
      p.venta.update({ where: { id: v.id }, data: { clienteNuevo: false } }),
    ).rejects.toThrow(/no se modifica/);
    const otro = await m.clientes.crearCliente(ctxDe(ownerId), {
      nombre: "Ajeno",
      telefono: telefono(),
      origenId: ownerId,
    });
    await expect(
      p.cliente.update({ where: { id: otro.id }, data: { creadoEnVentaId: v.id } }),
    ).rejects.toThrow(/no es suya/);
  });
});

describe("«¿De quién viene?» y la ganancia de cliente nuevo", () => {
  /** La fila de la venta en la ganancia del mes de Trinidad. */
  async function filaGanancia(ventaId: string) {
    const g = await m.ganancia.gananciaDelMes(ctxDe(ownerId), trinidadId, m.ganancia.mesActual());
    return g?.calculo.filas.find((f) => f.id === ventaId);
  }

  it("es obligatorio al dar de alta y tiene que ser un dueño o un vendedor del panel", async () => {
    await expect(
      m.clientes.crearCliente(ctxDe(ownerId), { nombre: "Sin origen", telefono: telefono() }),
    ).rejects.toBeInstanceOf(m.errores.ValidationError);
    await expect(
      m.clientes.crearCliente(ctxDe(ownerId), {
        nombre: "Origen inventado",
        telefono: telefono(),
        origenId: "no-existe",
      }),
    ).rejects.toBeInstanceOf(m.errores.ValidationError);
    expect(
      m.validaciones.clienteVentaSchema.safeParse({
        nuevo: { nombre: "A", telefono: "1155550000" },
      }).success,
    ).toBe(false);
    const opciones = (await m.clientes.listarOrigenesCliente({ panelId: VAPES })).map((o) => o.id);
    expect(opciones).toContain(ownerId);
    expect(opciones).toContain(trinidadId);
  });

  it("venta de Trinidad a un cliente que viene de ella: tarifa de cliente nuevo aunque diga «No»", async () => {
    const deTri = await m.clientes.crearCliente(ctxDe(ownerId), {
      nombre: "Viene de Tri",
      telefono: telefono(),
      origenId: trinidadId,
    });
    const v1 = await vender(trinidadId, { id: deTri.id }, 2);
    const v2 = await vender(trinidadId, { id: deTri.id }, 10, "MAYORISTA");
    // La venta en sí no es «alta de cliente nuevo» (eso no cambia: reportes de clientes nuevos).
    expect(v1.clienteNuevo).toBe(false);
    expect(await filaGanancia(v1.id)).toMatchObject({
      categoria: "MINORISTA_NUEVO",
      ganancia: "4000.00",
    });
    expect(await filaGanancia(v2.id)).toMatchObject({
      categoria: "MAYORISTA_NUEVO",
      ganancia: "5000.00",
    });
  });

  it("si el cliente viene de un dueño, es la tarifa común", async () => {
    const deDueno = await m.clientes.crearCliente(ctxDe(trinidadId), {
      nombre: "Viene del dueño",
      telefono: telefono(),
      origenId: ownerId,
    });
    const v = await vender(trinidadId, { id: deDueno.id }, 2);
    expect(await filaGanancia(v.id)).toMatchObject({ categoria: "MINORISTA", ganancia: "3000.00" });
  });

  it("los dueños completan el de un cliente viejo y el mes abierto se recalcula", async () => {
    const db = m.scoped.dbPara(VAPES);
    // Cliente cargado antes de v2.13.0: sin origen.
    const viejo = await db.cliente.create({
      data: { nombre: "Cliente viejo sin origen", telefono: `+54${telefono()}` },
    });
    expect(await m.clientes.contarClientesSinOrigen(ctxDe(ownerId))).toBeGreaterThan(0);
    const { clientes } = await m.clientes.listarClientesSinOrigen(ctxDe(ownerId));
    expect(clientes.some((c) => c.id === viejo.id)).toBe(true);
    const v = await vender(trinidadId, { id: viejo.id }, 1);
    expect(await filaGanancia(v.id)).toMatchObject({ categoria: "MINORISTA" });

    const cambiados = await m.clientes.asignarOrigenes(ctxDe(ownerId), [
      { clienteId: viejo.id, origenId: trinidadId },
    ]);
    expect(cambiados).toBe(1);
    expect(await filaGanancia(v.id)).toMatchObject({
      categoria: "MINORISTA_NUEVO",
      ganancia: "2000.00",
    });
    // Un empleado editando el cliente no puede cambiarlo.
    await m.clientes.actualizarCliente(ctxDe(trinidadId), {
      id: viejo.id,
      nombre: viejo.nombre,
      telefono: viejo.telefono,
      origenId: ownerId,
    });
    expect((await db.cliente.findUniqueOrThrow({ where: { id: viejo.id } })).origenId).toBe(
      trinidadId,
    );
  });
});
