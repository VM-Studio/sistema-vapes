import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * Ganancia por vape y liquidación mensual (A3, bloque 1), contra PostgreSQL:
 * las 4 categorías, venta anulada, zona horaria argentina en el corte de mes,
 * snapshot al liquidar, devolución en el mes siguiente, permisos, pago y
 * triggers de la liquidación pagada. Usa un vendedor propio (aislado de
 * Trinidad y de los demás tests).
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
  devoluciones: typeof import("@/server/services/devolucion.service");
  clientes: typeof import("@/server/services/cliente.service");
  movimientos: typeof import("@/server/services/movimiento.service");
  ganancia: typeof import("@/server/services/ganancia-vendedor.service");
  lib: typeof import("@/lib/ganancia-vendedor");
  reloj: typeof import("@/lib/reloj");
  vVenta: typeof import("@/lib/validations/venta");
  vDevolucion: typeof import("@/lib/validations/devolucion");
  errores: typeof import("@/server/errors");
};
let m: Modulos;
let ownerId: string;
let vendedorId: string;
let trinidadId: string;
let depositoId: string;
let varianteId: string;
let clienteViejo: string;
let mesA: string;
let mesB: string;
let mesC: string;
let ventaNuevoUnitaria: { id: string; clienteId: string };
let ventaAnulable: string;
const suf = String(Date.now()).slice(-6);
let tel = 0;
const telefono = () => `11${suf.slice(-4)}${String(5000 + tel++)}`;

const ctxDe = (usuarioId: string) => ({
  panelId: VAPES,
  usuarioId,
  meta: { ip: "127.0.0.1", userAgent: "vitest-ganancia" },
});

async function vender(
  cliente: { id: string } | { nuevo: { nombre: string; telefono: string } },
  cantidad: number,
  tipo: "UNITARIA" | "MAYORISTA",
) {
  return m.ventas.generarVenta(
    ctxDe(vendedorId),
    m.vVenta.generarVentaSchema.parse({
      depositoId,
      cliente,
      tipo,
      items: [{ varianteId, cantidad }],
      pagos: [{ medioPago: "EFECTIVO", monto: 8000 * cantidad }],
    }),
    { puedeEditar: false },
  );
}

/** Corre `fn` con la hora de negocio fija en `iso`. */
async function aLas<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  m.reloj.fijarReloj(() => new Date(iso));
  try {
    return await fn();
  } finally {
    m.reloj.fijarReloj(null);
  }
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    ventas: await import("@/server/services/venta.service"),
    devoluciones: await import("@/server/services/devolucion.service"),
    clientes: await import("@/server/services/cliente.service"),
    movimientos: await import("@/server/services/movimiento.service"),
    ganancia: await import("@/server/services/ganancia-vendedor.service"),
    lib: await import("@/lib/ganancia-vendedor"),
    reloj: await import("@/lib/reloj"),
    vVenta: await import("@/lib/validations/venta"),
    vDevolucion: await import("@/lib/validations/devolucion"),
    errores: await import("@/server/errors"),
  };
  const p = m.db.prisma;
  ownerId = (await p.usuario.findFirstOrThrow({ where: { rol: "OWNER" } })).id;
  trinidadId = (await p.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } })).id;
  vendedorId = (
    await p.usuario.create({
      data: {
        nombre: `Vendedor ganancia ${suf}`,
        email: `ganancia-${suf}@negocio.com`,
        rol: "EMPLEADO",
        passwordHash: "x",
        paneles: { create: [{ panelId: VAPES }] },
      },
    })
  ).id;
  const db = m.scoped.dbPara(VAPES);
  depositoId = (await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } })).id;
  const variante = await m.scoped.transaccion(ctxDe(ownerId), async (tx) => {
    const marca = await tx.marca.create({ data: { nombre: `Ganancia ${suf}` } });
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod G ${suf}`,
        especificacion: "8000",
        precioVenta: "8000.00",
        variantes: { create: [{ nombre: "Uva", sku: `GV-${suf}`, ultimoCosto: "4000.00" }] },
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
    motivo: "Preparación vitest ganancia",
  });
  clienteViejo = (
    await m.clientes.crearCliente(ctxDe(ownerId), {
      nombre: `Cliente viejo ${suf}`,
      telefono: telefono(),
    })
  ).id;
  mesC = m.ganancia.mesActual();
  mesB = m.lib.sumarMeses(mesC, -1);
  mesA = m.lib.sumarMeses(mesC, -2);
});

afterAll(async () => {
  m.reloj.fijarReloj(null);
  await m.db.prisma.$disconnect();
});

describe("tarifas", () => {
  it("sin tarifas no hay ganancia; solo un dueño las carga", async () => {
    expect(await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesC)).toBeNull();
    await expect(
      m.ganancia.guardarTarifas(ctxDe(vendedorId), vendedorId, {
        minorista: 1,
        mayorista: 1,
        minoristaNuevo: 1,
        mayoristaNuevo: 1,
      }),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
    await m.ganancia.guardarTarifas(ctxDe(ownerId), vendedorId, {
      minorista: 1500,
      mayorista: 300,
      minoristaNuevo: 2000,
      mayoristaNuevo: 500,
    });
    expect(await m.ganancia.obtenerTarifas(ctxDe(ownerId), vendedorId)).toMatchObject({
      minorista: "1500.00",
      mayorista: "300.00",
      minoristaNuevo: "2000.00",
      mayoristaNuevo: "500.00",
    });
  });

  it("Trinidad tiene las tarifas por defecto (seed)", async () => {
    expect(await m.ganancia.obtenerTarifas(ctxDe(ownerId), trinidadId)).toMatchObject({
      minorista: "1500.00",
      mayorista: "300.00",
      minoristaNuevo: "2000.00",
      mayoristaNuevo: "500.00",
    });
  });
});

describe("cálculo del mes", () => {
  it("las 4 categorías, la anulada no cuenta y el corte de mes es en hora argentina", async () => {
    await aLas(`${mesA}-10T15:00:00.000Z`, async () => {
      await vender({ id: clienteViejo }, 2, "UNITARIA"); // 2 × 1500
      await vender({ id: clienteViejo }, 10, "MAYORISTA"); // 10 × 300
      const v = await vender(
        { nuevo: { nombre: `Nuevo U ${suf}`, telefono: telefono() } },
        1,
        "UNITARIA",
      ); // 2000
      ventaNuevoUnitaria = { id: v.id, clienteId: v.cliente.id };
      await vender({ nuevo: { nombre: `Nuevo M ${suf}`, telefono: telefono() } }, 5, "MAYORISTA"); // 5 × 500
      ventaAnulable = (await vender({ id: clienteViejo }, 4, "UNITARIA")).id;
    });
    // 1° del mes B a las 02:30 UTC = último día del mes A, 23:30 en Argentina → mes A.
    await aLas(`${mesB}-01T02:30:00.000Z`, () => vender({ id: clienteViejo }, 1, "UNITARIA"));
    // 1° del mes B a las 03:30 UTC = 00:30 del mes B → mes B.
    await aLas(`${mesB}-01T03:30:00.000Z`, () => vender({ id: clienteViejo }, 3, "MAYORISTA"));
    await m.ventas.anularVenta(ctxDe(ownerId), ventaAnulable, "Cargada dos veces");

    const g = (await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesA))!;
    const por = Object.fromEntries(g.calculo.categorias.map((c) => [c.categoria, c]));
    expect(por.MINORISTA).toMatchObject({
      ventas: 2,
      unidades: 3,
      monto: "4500.00",
      totalVendido: "24000.00",
    });
    expect(por.MAYORISTA).toMatchObject({ ventas: 1, unidades: 10, monto: "3000.00" });
    expect(por.MINORISTA_NUEVO).toMatchObject({ ventas: 1, unidades: 1, monto: "2000.00" });
    expect(por.MAYORISTA_NUEVO).toMatchObject({ ventas: 1, unidades: 5, monto: "2500.00" });
    expect(g.calculo.total).toBe("12000.00");
    expect(g.calculo.cantidadVentas).toBe(5);
    expect(g.calculo.filas.some((f) => f.id === ventaAnulable)).toBe(false);
    expect(g.terminado).toBe(true);
    expect(g.liquidacion).toBeNull();

    const b = (await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesB))!;
    expect(b.calculo.total).toBe("900.00");
    expect(b.calculo.cantidadVentas).toBe(1);
  });

  it("el vendedor ve lo suyo, no lo de otro", async () => {
    const g = await m.ganancia.gananciaDelMes(ctxDe(vendedorId), vendedorId, mesA);
    expect(g?.calculo.total).toBe("12000.00");
    await expect(
      m.ganancia.gananciaDelMes(ctxDe(vendedorId), trinidadId, mesA),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
  });
});

describe("liquidación", () => {
  it("el mes en curso no se liquida; uno terminado guarda el snapshot", async () => {
    await expect(
      m.ganancia.generarLiquidacion(ctxDe(ownerId), vendedorId, mesC),
    ).rejects.toBeInstanceOf(m.errores.DomainError);
    await expect(
      m.ganancia.generarLiquidacion(ctxDe(vendedorId), vendedorId, mesA),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
    const r = await m.ganancia.generarLiquidacion(ctxDe(ownerId), vendedorId, mesA);
    expect(r.creada).toBe(true);
    // Cambian las tarifas: la liquidación queda como estaba; el mes B (sin liquidar) usa las nuevas.
    await m.ganancia.guardarTarifas(ctxDe(ownerId), vendedorId, {
      minorista: 1500,
      mayorista: 400,
      minoristaNuevo: 2000,
      mayoristaNuevo: 500,
    });
    const a = (await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesA))!;
    expect(a.liquidacion).toMatchObject({
      estado: "PENDIENTE",
      total: "12000.00",
      cantidadVentas: 5,
    });
    expect(a.calculo.tarifas.mayorista).toBe("300.00");
    expect(a.calculo.filas).toHaveLength(5);
    expect((await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesB))!.calculo.total).toBe(
      "1200.00",
    );
    // Recalcular mientras está pendiente: misma fila, tarifas nuevas.
    const r2 = await m.ganancia.generarLiquidacion(ctxDe(ownerId), vendedorId, mesA);
    expect(r2).toEqual({ id: r.id, creada: false });
    expect((await m.ganancia.obtenerLiquidacion(ctxDe(ownerId), r.id)).total).toBe("13000.00");
  });

  it("el cierre automático genera los meses que faltan desde que tiene tarifas", async () => {
    await m.scoped.dbPara(VAPES).tarifaVendedor.updateMany({
      where: { usuarioId: vendedorId },
      data: { createdAt: new Date(`${mesA}-05T12:00:00.000Z`) },
    });
    expect(await m.ganancia.asegurarLiquidaciones(ctxDe(ownerId), vendedorId)).toBe(1);
    expect(await m.ganancia.asegurarLiquidaciones(ctxDe(ownerId), vendedorId)).toBe(0);
    const hist = await m.ganancia.liquidacionesDe(ctxDe(ownerId), vendedorId);
    expect(hist.map((l) => [l.mes, l.total, l.generadaPor])).toEqual([
      [mesB, "1200.00", null],
      [mesA, "13000.00", expect.any(String)],
    ]);
    const pendientes = await m.ganancia.liquidacionesPendientes(ctxDe(ownerId));
    expect(pendientes.filter((l) => l.usuario.id === vendedorId)).toHaveLength(2);
  });

  it("una devolución descuenta en el mes de la devolución, sin tocar el mes liquidado", async () => {
    await m.devoluciones.registrarDevolucion(
      ctxDe(ownerId),
      m.vDevolucion.registrarDevolucionSchema.parse({
        clienteId: ventaNuevoUnitaria.clienteId,
        ventaId: ventaNuevoUnitaria.id,
        depositoId,
        items: [{ varianteId, cantidad: 1 }],
        observacion: "No prende, vino fallado de fábrica",
      }),
    );
    const c = (await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesC))!;
    const nuevo = c.calculo.categorias.find((x) => x.categoria === "MINORISTA_NUEVO")!;
    expect(nuevo).toMatchObject({ unidades: 0, unidadesDevueltas: 1, monto: "-2000.00" });
    expect(c.calculo.filas[0]).toMatchObject({
      tipo: "DEVOLUCION",
      ventaId: ventaNuevoUnitaria.id,
      unidades: -1,
    });
    expect(c.calculo.total).toBe("0.00");
    const a = (await m.ganancia.gananciaDelMes(ctxDe(ownerId), vendedorId, mesA))!;
    expect(a.calculo.total).toBe("13000.00");
  });

  it("pago: solo dueños, una vez; pagada no se recalcula ni se toca", async () => {
    const [b, a] = await m.ganancia.liquidacionesDe(ctxDe(ownerId), vendedorId);
    const pago = { monto: 13000, medioPago: "TRANSFERENCIA" as const, fecha: new Date() };
    await expect(
      m.ganancia.registrarPagoLiquidacion(ctxDe(vendedorId), a!.id, pago),
    ).rejects.toBeInstanceOf(m.errores.ForbiddenError);
    const r = await m.ganancia.registrarPagoLiquidacion(ctxDe(ownerId), a!.id, pago);
    expect(r).toMatchObject({ usuarioId: vendedorId, mes: mesA, monto: "13000.00" });
    const l = await m.ganancia.obtenerLiquidacion(ctxDe(vendedorId), a!.id);
    expect(l.estado).toBe("PAGADA");
    expect(l.pago).toMatchObject({
      monto: "13000.00",
      medioPago: "TRANSFERENCIA",
      registradoPor: { id: ownerId },
    });
    await expect(
      m.ganancia.registrarPagoLiquidacion(ctxDe(ownerId), a!.id, pago),
    ).rejects.toBeInstanceOf(m.errores.DomainError);
    await expect(
      m.ganancia.generarLiquidacion(ctxDe(ownerId), vendedorId, mesA),
    ).rejects.toBeInstanceOf(m.errores.DomainError);
    const db = m.scoped.dbPara(VAPES);
    await expect(
      db.liquidacionVendedor.update({ where: { id: a!.id }, data: { total: "1.00" } }),
    ).rejects.toThrow(/pagada/);
    await expect(db.liquidacionVendedor.delete({ where: { id: a!.id } })).rejects.toThrow(/pagada/);
    // La otra sigue pendiente.
    expect((await m.ganancia.obtenerLiquidacion(ctxDe(ownerId), b!.id)).estado).toBe("PENDIENTE");
  });
});
