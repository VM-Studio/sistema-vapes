import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { URL_VITEST } from "./setup";

/**
 * Mercado Libre en cualquier panel que lo habilite (acá Especiales, para no
 * tocar la numeración de Cosmetic que verifica otro test), contra PostgreSQL real:
 *  1. Una venta cobrada por ML exige el precio a mano de cada ítem (> 0); con
 *     los precios, el total es la suma, origenPrecio = ML, y costo y ganancia
 *     los calcula el servidor (sin el permiso "editar").
 *  2. Facturas → Ventas Mercado Libre: la venta aparece pendiente; «Cargado»
 *     (con archivo) la pasa a cargada y las tarjetas cambian.
 */

process.env.DATABASE_URL = URL_VITEST;
process.env.DIRECT_URL = URL_VITEST;
process.env.PRISMA_LOG = "silent";
process.env.LOG_LEVEL = "warn";

const PANEL = "pnl_especiales";

type Modulos = {
  db: typeof import("@/lib/db");
  scoped: typeof import("@/server/db/panel-scoped");
  config: typeof import("@/server/services/configuracion.service");
  ventas: typeof import("@/server/services/venta.service");
  clientes: typeof import("@/server/services/cliente.service");
  facturasML: typeof import("@/server/services/factura-ml.service");
  movimientos: typeof import("@/server/services/movimiento.service");
  validaciones: typeof import("@/lib/validations/venta");
  validacionesFactura: typeof import("@/lib/validations/factura");
  errores: typeof import("@/server/errors");
};
let m: Modulos;
let ctx: { panelId: string; usuarioId: string };
let depositoId: string;
let clienteId: string;
let serum: string;
let crema: string;
const suf = String(Date.now()).slice(-6);

function venderML(items: object[], monto: number) {
  return m.ventas.generarVenta(
    ctx,
    m.validaciones.generarVentaSchema.parse({
      depositoId,
      cliente: { id: clienteId },
      items,
      pagos: [{ medioPago: "MERCADO_LIBRE", monto }],
    }),
    { puedeEditar: false },
  );
}

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    scoped: await import("@/server/db/panel-scoped"),
    config: await import("@/server/services/configuracion.service"),
    ventas: await import("@/server/services/venta.service"),
    clientes: await import("@/server/services/cliente.service"),
    facturasML: await import("@/server/services/factura-ml.service"),
    movimientos: await import("@/server/services/movimiento.service"),
    validaciones: await import("@/lib/validations/venta"),
    validacionesFactura: await import("@/lib/validations/factura"),
    errores: await import("@/server/errors"),
  };
  const p = m.db.prisma;
  ctx = {
    panelId: PANEL,
    usuarioId: (await p.usuario.findFirstOrThrow({ where: { rol: "OWNER" } })).id,
  };
  await m.config.guardarConfigVentas(
    ctx,
    m.validaciones.configVentasSchema.parse({ mediosPago: ["EFECTIVO", "MERCADO_LIBRE"] }),
  );
  const db = m.scoped.dbPara(PANEL);
  depositoId = (await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } })).id;
  const { variantes, cliente } = await m.scoped.transaccion(ctx, async (tx) => {
    const marca = await tx.marca.create({ data: { nombre: `ML ${suf}` } });
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Serum ${suf}`,
        especificacion: "30 ml",
        precioVenta: "12000.00",
        // Dato viejo: ya no se cobra solo.
        precioVentaML: "15000.00",
        variantes: {
          create: [
            { nombre: "Rosa", sku: `ML-R-${suf}`, ultimoCosto: "5000.00" },
            { nombre: "Coco", sku: `ML-C-${suf}`, ultimoCosto: "3000.00" },
          ],
        },
      },
      include: { variantes: { orderBy: { nombre: "desc" } } },
    });
    const cliente = await m.clientes.crearCliente(
      ctx,
      { nombre: `Clienta ML ${suf}`, telefono: `11 5${suf.slice(-3)} ${suf.slice(0, 4)}` },
      tx,
    );
    return { variantes: producto.variantes, cliente };
  });
  [serum, crema] = [variantes[0]!.id, variantes[1]!.id];
  clienteId = cliente.id;
  for (const varianteId of [serum, crema])
    await m.movimientos.registrarAjuste(ctx, {
      depositoId,
      varianteId,
      cantidadReal: 20,
      motivo: "Preparación vitest ML",
    });
});

afterAll(async () => {
  await m.db.prisma.$disconnect();
});

describe("venta por Mercado Libre: precio a mano por ítem", () => {
  it("sin el precio de cada ítem no se registra", async () => {
    await expect(venderML([{ varianteId: serum, cantidad: 1 }], 15000)).rejects.toThrow(
      /precio de cada producto/,
    );
    await expect(
      venderML(
        [
          { varianteId: serum, cantidad: 1, precioML: 15000 },
          { varianteId: crema, cantidad: 1 },
        ],
        20000,
      ),
    ).rejects.toBeInstanceOf(m.errores.DomainError);
  });

  it("con los precios: total = suma, origen ML y costo/ganancia del servidor", async () => {
    const v = await venderML(
      [
        { varianteId: serum, cantidad: 2, precioML: 14500 },
        { varianteId: crema, cantidad: 1, precioML: "9999.99" },
      ],
      2 * 14500 + 9999.99,
    );
    expect(v.total).toBe("38999.99");
    expect(v.medioPago).toBe("MERCADO_LIBRE");
    expect(v.items.every((i) => i.origenPrecio === "ML" && !i.esPrecioEspecial)).toBe(true);
    expect(v.items.find((i) => i.varianteId === serum)!.precioUnitario).toBe("14500.00");
    const enDb = await m.db.prisma.venta.findUniqueOrThrow({ where: { id: v.id } });
    expect(enDb.costoTotal.toFixed(2)).toBe("13000.00");
    expect(enDb.gananciaBruta.toFixed(2)).toBe("25999.99");
  });
});

describe("Facturas → Ventas Mercado Libre", () => {
  it("la venta aparece pendiente; «Cargado» la pasa a cargada y cambian las tarjetas", async () => {
    const { listarVentasMLSchema, cargarFacturaMLSchema } = m.validacionesFactura;
    const antes = await m.facturasML.totalesFacturasML(ctx);
    const v = await venderML([{ varianteId: serum, cantidad: 1, precioML: 20000 }], 20000);
    const conNueva = await m.facturasML.totalesFacturasML(ctx);
    expect(conNueva.pendientes.cantidad).toBe(antes.pendientes.cantidad + 1);
    expect(Number(conNueva.pendientes.total) - Number(antes.pendientes.total)).toBe(20000);
    const pendientes = await m.facturasML.listarVentasML(
      ctx,
      listarVentasMLSchema.parse({ estado: "PENDIENTE", pageSize: 100 }),
    );
    expect(pendientes.ventas.find((x) => x.id === v.id)?.estado).toBe("PENDIENTE");

    // PNG mínimo (magic bytes): se acepta como imagen.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await m.facturasML.marcarFacturaMLCargada(
      ctx,
      cargarFacturaMLSchema.parse({ ventaId: v.id, fecha: "2026-10-25" }),
      { datos: png, nombre: "foto.png" },
    );
    const despues = await m.facturasML.totalesFacturasML(ctx);
    expect(despues.pendientes.cantidad).toBe(antes.pendientes.cantidad);
    expect(despues.cargadas.cantidad).toBe(antes.cargadas.cantidad + 1);
    expect(Number(despues.cargadas.total) - Number(antes.cargadas.total)).toBe(20000);
    const cargadas = await m.facturasML.listarVentasML(
      ctx,
      listarVentasMLSchema.parse({ estado: "CARGADA", pageSize: 100 }),
    );
    const fila = cargadas.ventas.find((x) => x.id === v.id)!;
    expect(fila.estado).toBe("CARGADA");
    expect(fila.factura).toMatchObject({ tieneArchivo: true, archivoTipo: "image/png" });
    const archivo = await m.facturasML.archivoFacturaML(ctx, v.id);
    expect(archivo.tipo).toBe("image/png");
    await expect(
      m.facturasML.marcarFacturaMLCargada(
        ctx,
        cargarFacturaMLSchema.parse({ ventaId: v.id, fecha: "2026-10-25" }),
      ),
    ).rejects.toThrow(/ya está cargada/);
  });
});
