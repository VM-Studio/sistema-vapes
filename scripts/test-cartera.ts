/**
 * Pedido de los dueños (2026-10-29) a nivel servicios + DB (panel Vapes):
 *
 * 1. Cartera de clientes del vendedor («Mis clientes»): los que ya tenía se
 *    cargan sin venta y venderles NO es cliente nuevo; el que se da de alta al
 *    vender se suma solo a su cartera como nuevo, atado a esa venta; teléfonos
 *    de clientes sin cartera se suman, los de otra cartera no; «Cargar
 *    varios»; quitar solo los que ya tenía; los dueños no tienen cartera.
 * 2. Borrador de «Nueva compra»: crear, pisar, listar, retomar y descartar.
 * 3. Producto nuevo desde la ficha del proveedor: producto + precio del
 *    proveedor en una sola transacción (si falla el precio, no queda el producto).
 *
 * Uso: pnpm test:cartera — pensado para una DB recién sembrada (crea datos).
 */
import { RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { productoSchema } from "../src/lib/validations/producto";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import {
  descartarBorradorCompra,
  guardarBorradorCompra,
  listarBorradoresCompra,
  obtenerBorradorCompra,
} from "../src/server/services/borrador-compra.service";
import {
  agregarACartera,
  ClienteEnOtraCarteraError,
  importarCartera,
  listarCartera,
  obtenerClienteDeCartera,
  quitarDeCartera,
  resumenCartera,
} from "../src/server/services/cartera-clientes.service";
import { ClienteDuplicadoError } from "../src/server/services/cliente.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import { crear as crearProducto } from "../src/server/services/producto.service";
import { asignarProducto } from "../src/server/services/proveedor.service";
import { generarVenta } from "../src/server/services/venta.service";

const VAPES = "pnl_vapes";
const db = dbPara(VAPES);

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
async function error(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const [vendedor, otro] = await prisma.usuario.findMany({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (!vendedor || !otro) throw new Error("Hacen falta dos empleados en Vapes (seed).");
  const meta = { ip: "127.0.0.1", userAgent: "test-cartera" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxVend: Ctx = { panelId: VAPES, usuarioId: vendedor.id, meta };
  const g1 = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const suf = String(Date.now()).slice(-6);
  const tel = (n: number) => `11${suf}${String(n).padStart(2, "0")}`;

  // Catálogo propio con stock.
  const prod = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Cartera" } },
      update: {},
      create: { nombre: "Test Cartera" },
    });
    return tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Pod ${suf}`,
        especificacion: "6000",
        precioVenta: "15000.00",
        variantes: { create: [{ nombre: "Uva", sku: `TC-U-${suf}`, ultimoCosto: "9000.00" }] },
      },
      include: { variantes: true },
    });
  });
  const uva = prod.variantes[0]!;
  await registrarAjuste(ctx, {
    depositoId: g1.id,
    varianteId: uva.id,
    cantidadReal: 50,
    motivo: "Preparación test-cartera",
  });
  const vender = (c: Ctx, cliente: unknown) =>
    generarVenta(
      c,
      generarVentaSchema.parse({
        depositoId: g1.id,
        cliente,
        items: [{ varianteId: uva.id, cantidad: 1 }],
        pagos: [{ medioPago: "EFECTIVO", monto: 15000 }],
      }),
      { puedeEditar: false },
    );

  // La cartera del vendedor puede traer datos de otras corridas: se compara contra esto.
  const base = await resumenCartera(ctxVend, vendedor.id);

  // ---------------------------------------------------------------------------
  console.log("\n1) «Ya lo tenía»: cargado en la cartera, venderle no es cliente nuevo");
  const previo = await agregarACartera(ctxVend, vendedor.id, {
    nombre: `Cliente Previo ${suf}`,
    telefono: tel(1),
  });
  check(previo.tipo === "CREADO", `alta en la cartera (${previo.tipo})`);
  const filaPrevio = await db.cliente.findUniqueOrThrow({ where: { id: previo.cliente.id } });
  check(
    filaPrevio.vendedorId === vendedor.id && filaPrevio.creadoEnVentaId === null,
    "queda en la cartera del vendedor, sin venta de alta",
  );
  const vPrevio = await vender(ctxVend, { id: previo.cliente.id });
  check(!vPrevio.clienteNuevo, "la venta al cliente que ya tenía NO es cliente nuevo");

  // ---------------------------------------------------------------------------
  console.log("\n2) «Cliente nuevo» al vender: se crea, se suma a la cartera y queda la venta");
  const vNuevo = await vender(ctxVend, {
    nuevo: { nombre: `Cliente Nuevo ${suf}`, telefono: tel(2) },
  });
  check(vNuevo.clienteNuevo, "la venta es de cliente nuevo");
  const filaNuevo = await db.cliente.findUniqueOrThrow({ where: { id: vNuevo.cliente.id } });
  check(
    filaNuevo.vendedorId === vendedor.id && filaNuevo.creadoEnVentaId === vNuevo.id,
    "se sumó a la cartera atado a esa venta",
  );
  const ficha = await obtenerClienteDeCartera(ctxVend, vendedor.id, vNuevo.cliente.id);
  check(
    ficha.cliente.ventaAlta?.codigo === vNuevo.codigo && ficha.ventas[0]?.clienteNuevo === true,
    `la ficha recuerda la venta que lo trajo (${ficha.cliente.ventaAlta?.codigo})`,
  );
  const r = await resumenCartera(ctxVend, vendedor.id);
  check(
    r.total - base.total === 2 &&
      r.previos - base.previos === 1 &&
      r.nuevos - base.nuevos === 1 &&
      r.nuevosDelMes - base.nuevosDelMes === 1,
    `resumen: +${r.total - base.total} en cartera, +${r.previos - base.previos} ya los tenía, +${r.nuevos - base.nuevos} nuevo`,
  );
  const nuevos = await listarCartera(ctxVend, vendedor.id, { filtro: "nuevos", q: suf, page: 1 });
  check(
    nuevos.total === 1 && nuevos.clientes[0]?.ventaAlta?.id === vNuevo.id,
    "filtro «Nuevos por ventas» con el link a la venta",
  );
  const previos = await listarCartera(ctxVend, vendedor.id, { filtro: "previos", q: suf, page: 1 });
  check(
    previos.total === 1 && previos.clientes[0]?.compras === 1,
    "filtro «Ya los tenía» (1 compra)",
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Dueños sin cartera; teléfonos de otros clientes");
  const vDueno = await vender(ctx, { nuevo: { nombre: `Del Negocio ${suf}`, telefono: tel(3) } });
  const filaDueno = await db.cliente.findUniqueOrThrow({ where: { id: vDueno.cliente.id } });
  check(filaDueno.vendedorId === null, "el cliente nuevo de un dueño no queda en ninguna cartera");
  const dup = await error(() =>
    agregarACartera(ctxVend, vendedor.id, { nombre: `Otro nombre ${suf}`, telefono: tel(3) }),
  );
  check(dup instanceof ClienteDuplicadoError, `sin «sumar»: teléfono repetido (${msg(dup)})`);
  const sumado = await agregarACartera(
    ctxVend,
    vendedor.id,
    { nombre: `Otro nombre ${suf}`, telefono: tel(3) },
    { sumarExistente: true },
  );
  check(sumado.tipo === "SUMADO", "con «sumar»: el cliente del negocio se suma a la cartera");
  check(
    (await db.cliente.findUniqueOrThrow({ where: { id: vDueno.cliente.id } })).vendedorId ===
      vendedor.id,
    "y queda en la cartera (sin venta de alta del vendedor: no es nuevo)",
  );
  const yaEstaba = await agregarACartera(ctxVend, vendedor.id, {
    nombre: `Cliente Previo ${suf}`,
    telefono: tel(1),
  });
  check(yaEstaba.tipo === "YA_ESTABA", "cargar de nuevo uno propio → «ya estaba»");
  const deOtro = await db.cliente.create({
    data: { nombre: `De Otro ${suf}`, telefono: `+54${tel(4)}`, vendedorId: otro.id },
  });
  const otraCartera = await error(() =>
    agregarACartera(
      ctxVend,
      vendedor.id,
      { nombre: `De Otro ${suf}`, telefono: tel(4) },
      { sumarExistente: true },
    ),
  );
  check(
    otraCartera instanceof ClienteEnOtraCarteraError,
    `el de la cartera de otro vendedor no se suma (${msg(otraCartera)})`,
  );
  const vOtro = await vender(ctxVend, { id: deOtro.id });
  check(!vOtro.clienteNuevo, "venderle al cliente de otro vendedor tampoco es cliente nuevo");

  // ---------------------------------------------------------------------------
  console.log("\n4) «Cargar varios»");
  const filas = await importarCartera(
    ctxVend,
    vendedor.id,
    [
      `Ana Lista, ${tel(5)}`,
      `Beto Lista;${tel(6)}`,
      `Cliente Previo\t${tel(1)}`,
      "solo un nombre",
      `Kiosco Lo de Tito ${tel(7)}`,
    ].join("\n"),
  );
  check(
    filas.map((f) => f.resultado).join() === "CREADO,CREADO,YA_ESTABA,ERROR,CREADO",
    `una por línea: ${filas.map((f) => f.resultado).join(", ")}`,
  );
  const tito = await db.cliente.findFirst({ where: { telefono: `+54${tel(7)}` } });
  check(tito?.nombre === "Kiosco Lo de Tito", "sin separador: el teléfono es la cola numérica");
  const r4 = await resumenCartera(ctxVend, vendedor.id);
  check(
    r4.previos - base.previos === 5 && r4.nuevos - base.nuevos === 1,
    `quedan como «ya los tenía» (+${r4.previos - base.previos}; el sumado de un dueño no es nuevo)`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n5) Quitar de la cartera");
  const noQuita = await error(() => quitarDeCartera(ctxVend, vendedor.id, vNuevo.cliente.id));
  check(noQuita !== null, `el nuevo de una venta no se quita (${msg(noQuita)})`);
  await quitarDeCartera(ctxVend, vendedor.id, previo.cliente.id);
  check(
    (await db.cliente.findUniqueOrThrow({ where: { id: previo.cliente.id } })).vendedorId === null,
    "el que ya tenía se quita (sigue siendo cliente del negocio)",
  );

  // ---------------------------------------------------------------------------
  console.log("\n6) Borrador de «Nueva compra»");
  const proveedor = await db.proveedor.create({
    data: { nombre: `Prov ${suf}`, nombreTienda: "Tienda Test Cartera" },
  });
  const datos = {
    proveedorId: proveedor.id,
    depositoId: g1.id,
    fecha: "2026-10-29",
    notas: "a medias",
    comisionActiva: true,
    comisionPct: "5",
    moneda: "USDT" as const,
    items: [
      {
        varianteId: uva.id,
        productoId: prod.id,
        nombreCompleto: prod.nombreCompleto,
        sabor: "Uva",
        sku: uva.sku,
        cantidad: "12",
        costo: "5.6",
        origenCosto: "manual" as const,
      },
    ],
  };
  const b = await guardarBorradorCompra(ctx, { datos });
  const b2 = await guardarBorradorCompra(ctx, {
    id: b.id,
    datos: { ...datos, items: [{ ...datos.items[0]!, cantidad: "20" }] },
  });
  check(b2.id === b.id, "guardar con el id pisa el mismo borrador");
  const lista = await listarBorradoresCompra(ctx);
  const fila = lista.find((x) => x.id === b.id);
  check(
    fila?.unidades === 20 &&
      fila.items === 1 &&
      fila.proveedor?.includes("Tienda Test Cartera") === true,
    `listado: ${fila?.items} ítem, ${fila?.unidades} u., ${fila?.proveedor}`,
  );
  const retomado = await obtenerBorradorCompra(ctx, b.id);
  check(
    retomado.datos.items[0]?.cantidad === "20" &&
      retomado.datos.notas === "a medias" &&
      retomado.datos.comisionPct === "5",
    "se retoma tal cual quedó",
  );
  const ajeno = await guardarBorradorCompra(ctx, {
    datos: { ...datos, proveedorId: "no-existe" },
  });
  check(
    (await obtenerBorradorCompra(ctx, ajeno.id)).datos.proveedorId === "",
    "un proveedor inexistente se descarta",
  );
  await descartarBorradorCompra(ctx, b.id);
  await descartarBorradorCompra(ctx, ajeno.id);
  check((await error(() => obtenerBorradorCompra(ctx, b.id))) !== null, "descartado: ya no existe");
  const recreado = await guardarBorradorCompra(ctx, { id: b.id, datos });
  check(recreado.id !== b.id, "guardar uno descartado crea otro (lo tipeado no se pierde)");
  await descartarBorradorCompra(ctx, recreado.id);

  // ---------------------------------------------------------------------------
  console.log("\n7) Producto nuevo desde el proveedor (producto + precio, todo o nada)");
  const producto = productoSchema.parse({
    marca: "Test Cartera",
    modelo: `Desde Proveedor ${suf}`,
    especificacion: "8000",
    precioVenta: "20000",
    categoriaId: "",
    precioVentaML: "",
    imagenUrl: "",
    activo: true,
    sabores: [
      {
        sabor: "Menta",
        codigoBarras: "",
        precioVenta: "",
        precioVentaML: "",
        stockMinimo: "0",
        activo: true,
      },
    ],
  });
  const creado = await transaccion(ctx, async (tx) => {
    const p = await crearProducto(ctx, producto, tx);
    await asignarProducto(ctx, proveedor.id, { productoId: p.id, precio: 6.5, moneda: "USDT" }, tx);
    return p;
  });
  const asignado = await db.proveedorProducto.findFirst({
    where: { proveedorId: proveedor.id, productoId: creado.id },
  });
  check(
    asignado?.precio.toFixed(2) === "6.50" && asignado.moneda === "USDT",
    "queda en la lista del proveedor con su precio (6,50 USDT)",
  );
  const otroModelo = productoSchema.parse({ ...producto, modelo: `Falla ${suf}` });
  const falla = await error(() =>
    transaccion(ctx, async (tx) => {
      const p = await crearProducto(ctx, otroModelo, tx);
      await asignarProducto(
        ctx,
        "proveedor-inexistente",
        { productoId: p.id, precio: 1, moneda: "USDT" },
        tx,
      );
    }),
  );
  check(falla !== null, `proveedor inválido → error (${msg(falla)})`);
  check(
    (await db.producto.count({ where: { nombre: `Falla ${suf}` } })) === 0,
    "y el producto no quedó creado",
  );

  console.log(fallos ? `\n✘ ${fallos} chequeo(s) fallaron` : "\n✔ Todo OK");
  if (fallos) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
