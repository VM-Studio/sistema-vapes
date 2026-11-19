import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * v2.11.0, contra PostgreSQL real:
 *  1. generarVenta avisa los sabores que se quedaron en 0 en el galpón
 *     («se vendió la última unidad»), con lo que queda en otros galpones.
 *  2. «Productos sin código de barras»: lista los sabores sin código de
 *     fábrica (sin código o con uno interno, y sin alternativos);
 *     vincularCodigo lo deja como principal (o alternativo si ya tenía uno)
 *     y rechaza códigos de otro sabor.
 *  3. agregarSabor (desde la hoja de Compras): mismo resultado que el
 *     formulario de producto: SKU, stock en 0 en todos los galpones,
 *     nombre y código sin repetir, precio propio solo si difiere, auditoría.
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
  productos: typeof import("@/server/services/producto.service");
  movimientos: typeof import("@/server/services/movimiento.service");
  valVenta: typeof import("@/lib/validations/venta");
  valProducto: typeof import("@/lib/validations/producto");
};
let m: Modulos;
let ownerId: string;
let depositoId: string;
let otroDepositoId: string;
let productoId: string;
let mangoId: string;
let uvaId: string;
const suf = String(Date.now()).slice(-6);

const ctx = () => ({
  panelId: VAPES,
  usuarioId: ownerId,
  meta: { ip: "127.0.0.1", userAgent: "vitest-v2110" },
});

async function stockDe(varianteId: string, deposito: string): Promise<number> {
  const s = await m.scoped
    .dbPara(VAPES)
    .stock.findFirst({ where: { varianteId, depositoId: deposito } });
  return s?.cantidad ?? -1;
}

function vender(items: { varianteId: string; cantidad: number }[]) {
  return m.ventas.generarVenta(
    ctx(),
    m.valVenta.generarVentaSchema.parse({
      depositoId,
      cliente: { nuevo: { nombre: `Cliente ${suf}`, telefono: `11${suf}${items.length}9` } },
      tipo: "UNITARIA",
      items,
      pagos: [
        {
          medioPago: "EFECTIVO",
          monto: 9000 * items.reduce((a, i) => a + i.cantidad, 0),
        },
      ],
    }),
    { puedeEditar: false },
  );
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    ventas: await import("@/server/services/venta.service"),
    productos: await import("@/server/services/producto.service"),
    movimientos: await import("@/server/services/movimiento.service"),
    valVenta: await import("@/lib/validations/venta"),
    valProducto: await import("@/lib/validations/producto"),
  };
  const p = m.db.prisma;
  ownerId = (await p.usuario.findFirstOrThrow({ where: { rol: "OWNER" } })).id;
  const db = m.scoped.dbPara(VAPES);
  const depositos = await db.deposito.findMany({
    where: { activo: true },
    orderBy: { esPrincipal: "desc" },
  });
  expect(depositos.length).toBeGreaterThanOrEqual(2);
  depositoId = depositos[0]!.id;
  otroDepositoId = depositos[1]!.id;

  const creado = await m.productos.crear(
    ctx(),
    m.valProducto.productoSchema.parse({
      marca: `Aviso ${suf}`,
      modelo: "Pod",
      especificacion: "9000",
      precioVenta: "9000",
      sabores: [
        { sabor: "Mango", codigoBarras: "" },
        { sabor: "Uva", codigoBarras: `779${suf}01` },
      ],
    }),
  );
  productoId = creado.id;
  mangoId = creado.variantes.find((v) => v.nombre === "Mango")!.id;
  uvaId = creado.variantes.find((v) => v.nombre === "Uva")!.id;
  await db.variante.updateMany({
    where: { id: { in: [mangoId, uvaId] } },
    data: { ultimoCostoUsdt: "3.00" },
  });
  for (const [varianteId, deposito, cantidad] of [
    [mangoId, depositoId, 2],
    [uvaId, depositoId, 1],
    [uvaId, otroDepositoId, 4],
  ] as const) {
    await m.movimientos.registrarAjuste(ctx(), {
      depositoId: deposito,
      varianteId,
      cantidadReal: cantidad,
      motivo: "Preparación vitest v2.11.0",
    });
  }
});

afterAll(async () => {
  await m.db.prisma.$disconnect();
});

describe("aviso de última unidad", () => {
  it("una venta que no deja nada en 0 no avisa", async () => {
    const v = await vender([{ varianteId: mangoId, cantidad: 1 }]);
    expect(v.agotados).toEqual([]);
    expect(await stockDe(mangoId, depositoId)).toBe(1);
  });

  it("avisa los sabores que quedaron en 0 en el galpón, con lo de otros galpones", async () => {
    const v = await vender([
      { varianteId: mangoId, cantidad: 1 },
      { varianteId: uvaId, cantidad: 1 },
    ]);
    const porId = Object.fromEntries(v.agotados.map((a) => [a.varianteId, a]));
    expect(Object.keys(porId).sort()).toEqual([mangoId, uvaId].sort());
    expect(porId[mangoId]!.enOtrosGalpones).toBe(0);
    expect(porId[mangoId]!.titulo).toContain("Mango");
    expect(porId[uvaId]!.enOtrosGalpones).toBe(4);
    expect(await stockDe(mangoId, depositoId)).toBe(0);
    expect(await stockDe(uvaId, depositoId)).toBe(0);
  });
});

describe("productos sin código de barras", () => {
  it("lista el sabor sin código y no el que tiene", async () => {
    const lista = await m.productos.listarSinCodigo(ctx());
    const ids = lista.map((s) => s.varianteId);
    expect(ids).toContain(mangoId);
    expect(ids).not.toContain(uvaId);
  });

  it("rechaza un código que ya es de otro sabor", async () => {
    await expect(m.productos.vincularCodigo(ctx(), mangoId, `779${suf}01`)).rejects.toThrow(
      /ya pertenece/,
    );
  });

  it("vincula el código escaneado como principal y sale de la lista", async () => {
    const r = await m.productos.vincularCodigo(ctx(), mangoId, ` 779${suf}02 `);
    expect(r).toMatchObject({ varianteId: mangoId, codigo: `779${suf}02`, como: "principal" });
    const v = await m.scoped.dbPara(VAPES).variante.findUniqueOrThrow({ where: { id: mangoId } });
    expect(v.codigoBarras).toBe(`779${suf}02`);
    const encontrado = await m.productos.buscarPorCodigo(ctx(), `779${suf}02`);
    expect(encontrado?.varianteId).toBe(mangoId);
    const lista = await m.productos.listarSinCodigo(ctx());
    expect(lista.map((s) => s.varianteId)).not.toContain(mangoId);
  });

  it("un sabor con código interno de etiqueta aparece y el escaneado queda como alternativo", async () => {
    const creado = await m.productos.crear(
      ctx(),
      m.valProducto.productoSchema.parse({
        marca: `Aviso ${suf}`,
        modelo: "Etiqueta",
        precioVenta: "5000",
        sabores: [{ sabor: "Menta", codigoBarras: "" }],
      }),
    );
    const id = creado.variantes[0]!.id;
    const { asignados } = await m.productos.asignarCodigosInternos(ctx(), [id]);
    const interno = asignados[0]!.codigo;
    expect((await m.productos.listarSinCodigo(ctx())).map((s) => s.varianteId)).toContain(id);
    const r = await m.productos.vincularCodigo(ctx(), id, `779${suf}03`);
    expect(r.como).toBe("alternativo");
    expect((await m.productos.buscarPorCodigo(ctx(), interno))?.varianteId).toBe(id);
    expect((await m.productos.buscarPorCodigo(ctx(), `779${suf}03`))?.varianteId).toBe(id);
    expect((await m.productos.listarSinCodigo(ctx())).map((s) => s.varianteId)).not.toContain(id);
  });
});

describe("agregar sabor desde la compra", () => {
  it("crea el sabor con SKU, stock en 0 en todos los galpones y auditoría", async () => {
    const r = await m.productos.agregarSabor(
      ctx(),
      m.valProducto.agregarSaborSchema.parse({
        productoId,
        sabor: "  Frutilla   Ice ",
        codigoBarras: `779${suf}04`,
        precioVenta: "9000",
      }),
    );
    expect(r.sabor).toBe("Frutilla Ice");
    expect(r.sku).toMatch(/^[A-Z0-9]+-[A-Z0-9]{6}$/);
    const db = m.scoped.dbPara(VAPES);
    const v = await db.variante.findUniqueOrThrow({ where: { id: r.varianteId } });
    expect(v.productoId).toBe(productoId);
    expect(v.codigoBarras).toBe(`779${suf}04`);
    // Igual al del producto: no queda como precio propio.
    expect(v.precioVenta).toBeNull();
    expect(v.activo).toBe(true);
    const depositos = await db.deposito.count();
    const stocks = await db.stock.findMany({ where: { varianteId: r.varianteId } });
    expect(stocks).toHaveLength(depositos);
    expect(stocks.every((s) => s.cantidad === 0)).toBe(true);
    const audit = await m.db.prisma.auditLog.findFirst({
      where: { entidad: "Producto", entidadId: productoId, accion: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit?.datosDespues)).toContain("Frutilla Ice");
  });

  it("precio propio distinto queda en el sabor", async () => {
    const r = await m.productos.agregarSabor(
      ctx(),
      m.valProducto.agregarSaborSchema.parse({ productoId, sabor: "Sandía", precioVenta: "9500" }),
    );
    const v = await m.scoped
      .dbPara(VAPES)
      .variante.findUniqueOrThrow({ where: { id: r.varianteId } });
    expect(String(v.precioVenta)).toBe("9500");
    expect(v.codigoBarras).toBeNull();
  });

  it("rechaza sabor repetido (sin importar mayúsculas) y código en uso", async () => {
    await expect(
      m.productos.agregarSabor(
        ctx(),
        m.valProducto.agregarSaborSchema.parse({ productoId, sabor: "MANGO" }),
      ),
    ).rejects.toThrow(/ya tiene el sabor/);
    await expect(
      m.productos.agregarSabor(
        ctx(),
        m.valProducto.agregarSaborSchema.parse({
          productoId,
          sabor: "Kiwi",
          codigoBarras: `779${suf}01`,
        }),
      ),
    ).rejects.toThrow(/ya pertenece/);
  });

  it("no agrega sabores a un producto cargado sin sabores", async () => {
    const creado = await m.productos.crear(
      ctx(),
      m.valProducto.productoSchema.parse({
        marca: `Aviso ${suf}`,
        modelo: "Sin sabores",
        precioVenta: "1000",
        sabores: [{ sabor: "", codigoBarras: "" }],
      }),
    );
    await expect(
      m.productos.agregarSabor(
        ctx(),
        m.valProducto.agregarSaborSchema.parse({ productoId: creado.id, sabor: "Mango" }),
      ),
    ).rejects.toThrow(/sin sabores/);
  });
});
