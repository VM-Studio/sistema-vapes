import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * AISLAMIENTO ENTRE PANELES, contra PostgreSQL real (base aislada del setup):
 *  1. dbPara(): lo creado en Vapes no existe para Cosmetic, ni por id ni por código.
 *  2. dbPara(): una query que trae OTRO panelId lanza (es un bug, no se tolera).
 *  3. DB: aunque se use el cliente crudo, una fila no puede apuntar a filas de
 *     otro panel, ni insertarse sin panel, ni cambiar de panel.
 *  4. Unicidades por panel y numeración correlativa por panel.
 */

process.env.DATABASE_URL = URL_VITEST;
process.env.DIRECT_URL = URL_VITEST;
process.env.PRISMA_LOG = "silent";

const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const EAN = "7790000000017";

type Modulos = {
  db: typeof import("@/lib/db");
  scoped: typeof import("@/server/db/panel-scoped");
  secuencia: typeof import("@/server/db/secuencia");
  paneles: typeof import("@/lib/paneles");
};
let m: Modulos;
let usuarioId: string;
let productoVapesId: string;
let varianteVapesId: string;

/** Crea marca + categoría + producto + sabor (con EAN) en un panel, como lo haría el servicio. */
async function crearProducto(panelId: string, nombre: string) {
  const ctx = { panelId, usuarioId };
  return m.scoped.transaccion(ctx, async (tx) => {
    const categoria = await tx.categoria.create({ data: { nombre: `Cat ${nombre}` } });
    const marca = await tx.marca.create({ data: { nombre: `Marca ${nombre}` } });
    const producto = await tx.producto.create({
      data: {
        nombre,
        marcaId: marca.id,
        categoriaId: categoria.id,
        precioVenta: "150.00",
        variantes: {
          create: [
            {
              nombre: "Único",
              sku: `SKU-${nombre}`,
              codigoBarras: EAN,
              ultimoCosto: "100.00",
            },
          ],
        },
      },
      include: { variantes: true },
    });
    return { producto, variante: producto.variantes[0]! };
  });
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    secuencia: await import("@/server/db/secuencia"),
    paneles: await import("@/lib/paneles"),
  };
  const owner = await m.db.prisma.usuario.findFirstOrThrow({ where: { rol: "OWNER" } });
  usuarioId = owner.id;
  const { producto, variante } = await crearProducto(VAPES, "Aislado Vapes");
  productoVapesId = producto.id;
  varianteVapesId = variante.id;
});

afterAll(async () => {
  await m.db.prisma.$disconnect();
});

describe("dbPara: aislamiento en la capa de datos", () => {
  it("los nested create heredan el panel (la variante quedó en Vapes)", async () => {
    const v = await m.db.prisma.variante.findUniqueOrThrow({ where: { id: varianteVapesId } });
    expect(v.panelId).toBe(VAPES);
  });

  it("un producto de Vapes es invisible desde Cosmetic: por id, por código y en listados", async () => {
    const cosmetic = m.scoped.dbPara(COSMETIC);
    expect(await cosmetic.producto.findUnique({ where: { id: productoVapesId } })).toBeNull();
    expect(await cosmetic.variante.findFirst({ where: { codigoBarras: EAN } })).toBeNull();
    expect(await cosmetic.producto.count({ where: { id: productoVapesId } })).toBe(0);
    const lista = await cosmetic.producto.findMany({ select: { id: true } });
    expect(lista.map((p) => p.id)).not.toContain(productoVapesId);
    // …y desde Vapes sí está.
    const vapes = m.scoped.dbPara(VAPES);
    expect(await vapes.producto.findUnique({ where: { id: productoVapesId } })).not.toBeNull();
  });

  it("update / delete por id de otro panel: no encuentra la fila (no la toca)", async () => {
    const cosmetic = m.scoped.dbPara(COSMETIC);
    await expect(
      cosmetic.producto.update({
        where: { id: productoVapesId },
        data: { imagenUrl: "hackeado" },
      }),
    ).rejects.toThrow();
    const r = await cosmetic.producto.updateMany({
      where: { id: productoVapesId },
      data: { imagenUrl: "hackeado" },
    });
    expect(r.count).toBe(0);
    const p = await m.db.prisma.producto.findUniqueOrThrow({ where: { id: productoVapesId } });
    expect(p.imagenUrl).not.toBe("hackeado");
  });

  it("una query con OTRO panelId lanza PanelAislamientoError", async () => {
    const cosmetic = m.scoped.dbPara(COSMETIC);
    await expect(cosmetic.producto.findMany({ where: { panelId: VAPES } })).rejects.toThrow(
      m.scoped.PanelAislamientoError,
    );
    await expect(
      cosmetic.categoria.create({ data: { nombre: "Colada", panelId: VAPES } }),
    ).rejects.toThrow(m.scoped.PanelAislamientoError);
    await expect(
      cosmetic.producto.findFirst({ where: { panelId: { in: [VAPES, COSMETIC] } } }),
    ).rejects.toThrow(m.scoped.PanelAislamientoError);
  });

  it("el mismo EAN puede existir en dos paneles (unicidad por panel)", async () => {
    const { variante } = await crearProducto(COSMETIC, "Aislado Cosmetic");
    expect(variante.codigoBarras).toBe(EAN);
    expect(variante.panelId).toBe(COSMETIC);
    // Pero no dos veces en el mismo panel.
    await expect(crearProducto(VAPES, "Duplicado Vapes")).rejects.toThrow();
  });
});

describe("DB: segunda red, aunque se use el cliente crudo", () => {
  it("un Stock de Cosmetic no puede apuntar a una variante de Vapes", async () => {
    const deposito = await m.db.prisma.deposito.findFirstOrThrow({ where: { panelId: COSMETIC } });
    await expect(
      m.db.prisma.stock.create({
        data: { panelId: COSMETIC, varianteId: varianteVapesId, depositoId: deposito.id },
      }),
    ).rejects.toThrow(/otro panel/);
  });

  it("un INSERT sin panelId falla (DEFAULT current_setting sin valor → NOT NULL)", async () => {
    await expect(
      m.db.prisma
        .$executeRaw`INSERT INTO "Marca" ("id", "nombre", "updatedAt") VALUES ('marca_sin_panel', 'Sin panel', now())`,
    ).rejects.toThrow(/panelId|null/i);
  });

  it("un precio de proveedor de Cosmetic no puede apuntar a un producto de Vapes", async () => {
    const proveedor = await m.db.prisma.proveedor.create({
      data: { panelId: COSMETIC, nombre: "Contacto", nombreTienda: "Tienda Cosmetic" },
    });
    await expect(
      m.db.prisma.proveedorProducto.create({
        data: {
          panelId: COSMETIC,
          proveedorId: proveedor.id,
          productoId: productoVapesId,
          precio: "10.00",
          usuarioId,
        },
      }),
    ).rejects.toThrow(/otro panel/);
  });

  it("panelId no se puede cambiar", async () => {
    await expect(
      m.db.prisma.producto.update({ where: { id: productoVapesId }, data: { panelId: COSMETIC } }),
    ).rejects.toThrow(/panelId|otro panel/);
  });
});

describe("numeración por panel", () => {
  it("siguienteNumero es correlativo e independiente por panel; ID de venta con prefijo", async () => {
    const tomar = (panelId: string) =>
      m.scoped.transaccion({ panelId }, (tx) => m.secuencia.siguienteNumero(tx, panelId, "VENTA"));
    const v1 = await tomar(VAPES);
    const v2 = await tomar(VAPES);
    const c1 = await tomar(COSMETIC);
    expect(v2).toBe(v1 + 1);
    expect(c1).toBe(1);
    expect(m.paneles.formatearIdVenta("vapes", 1)).toBe("VAP-000001");
    expect(m.paneles.formatearIdVenta("cosmetic", c1)).toBe("COS-000001");
    expect(m.paneles.formatearIdVenta("prueba", 1)).toBe("PRU-000001");
  });

  it("20 ventas concurrentes en el mismo panel no repiten número", async () => {
    const numeros = await Promise.all(
      Array.from({ length: 20 }, () =>
        m.scoped.transaccion(
          { panelId: COSMETIC },
          (tx) => m.secuencia.siguienteNumero(tx, COSMETIC, "COMPRA"),
          { maxRetries: 20 },
        ),
      ),
    );
    expect(new Set(numeros).size).toBe(20);
    expect(Math.max(...numeros)).toBe(20);
  });
});
