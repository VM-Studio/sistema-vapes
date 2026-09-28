/**
 * Catálogo, stock y movimientos a nivel servicios + DB (panel Vapes).
 * Uso: pnpm test:catalogo   — pensado para una DB recién sembrada (crea datos).
 * Con PRISMA_LOG=query verifica además que buscarPorCodigo haga UNA sola query.
 */
import { EstadoTransferencia, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { listarMovimientosSchema } from "../src/lib/validations/movimiento";
import { listarProductosSchema, productoSchema } from "../src/lib/validations/producto";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError } from "../src/server/errors";
import { cambiarActivoClasificacion } from "../src/server/services/clasificacion.service";
import { cambiarActivoDeposito } from "../src/server/services/deposito.service";
import {
  filtrosStockSchema,
  obtenerStock,
  obtenerStockPorProducto,
} from "../src/server/services/inventario.service";
import {
  anularTransferencia,
  completarTransferencia,
  crearTransferencia,
  listarMovimientos,
  registrarAjuste,
  registrarAjusteMasivo,
  registrarIngresoManual,
} from "../src/server/services/movimiento.service";
import {
  actualizarProducto,
  agregarCodigoAlternativo,
  buscarPorCodigo,
  crearProducto,
  listarProductos,
  obtenerProducto,
} from "../src/server/services/producto.service";

const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const db = dbPara(VAPES);

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
function mensaje(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const conector = /message: "((?:[^"\\]|\\.)*)"/.exec(msg)?.[1]?.replace(/\\"/g, '"');
  const pg = /ERROR: ([^`\n]+)/.exec(msg)?.[1];
  return conector ?? pg ?? msg.split("\n").filter(Boolean).pop() ?? msg;
}
async function error(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-catalogo" };
  const actor: Ctx & { usuario: { rol: RolUsuario } } = {
    panelId: VAPES,
    usuarioId: owner.id,
    meta,
    usuario: { rol: RolUsuario.OWNER },
  };
  const vistaEmpleado = { panelId: VAPES, usuario: { rol: RolUsuario.EMPLEADO } };
  const [g1, g2] = await db.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");
  const vapes = await db.categoria.findFirstOrThrow({ where: { nombre: "Vapes" } });
  const marca = await db.marca.findFirstOrThrow({ where: { nombre: "Elf Bar" } });
  const sufijo = String(Date.now()).slice(-6);

  // ---------------------------------------------------------------------------
  console.log("\n1) Vape con 5 sabores y EAN-13; repetir un código de otro sabor → error claro");
  const sabores = ["Mango Ice", "Blueberry", "Cola", "Menta", "Sandía"];
  const codigos = sabores.map((_, i) => generarEan13(`7798${sufijo}${String(i).padStart(2, "0")}`));
  const input = productoSchema.parse({
    nombre: `Lost Mary ${sufijo}`,
    categoriaId: vapes.id,
    marcaId: marca.id,
    tieneVariantes: true,
    variantes: sabores.map((nombre, i) => ({
      nombre,
      codigoBarras: codigos[i],
      precioCosto: "7000",
      precioVenta: "13000",
      stockMinimo: "10",
    })),
  });
  const creado = await crearProducto(actor, input);
  const detalle = await obtenerProducto(actor, creado.id);
  check(
    detalle.variantes.length === 5,
    `producto creado con 5 variantes: ${detalle.variantes.map((v) => v.nombre).join(", ")}`,
  );
  check(
    detalle.variantes.every((v) => /^PRD-[A-Z2-9]{6}$/.test(v.sku)),
    `SKUs autogenerados con prefijo del panel: ${detalle.variantes.map((v) => v.sku).join(", ")}`,
  );
  check(
    detalle.variantes.every((v) => v.precioCosto === "7000.00" && v.margen !== null),
    "el dueño ve costo y margen",
  );
  const vistaEmp = await obtenerProducto(vistaEmpleado, creado.id);
  check(
    vistaEmp.variantes.every((v) => v.precioCosto === null && v.margen === null),
    "un empleado no recibe costo ni margen",
  );
  const repetido = productoSchema.safeParse({
    ...input,
    variantes: [
      { nombre: "Uva", codigoBarras: codigos[0], precioCosto: 1, precioVenta: 2 },
      { nombre: "Frutilla", codigoBarras: codigos[0], precioCosto: 1, precioVenta: 2 },
    ],
  });
  check(
    !repetido.success &&
      repetido.error.issues.some((i) => i.path.join(".") === "variantes.1.codigoBarras"),
    `mismo código en dos sabores del formulario → Zod: "${repetido.error?.issues[0]?.message}"`,
  );
  const eDb = await error(() =>
    crearProducto(
      actor,
      productoSchema.parse({
        nombre: `Otro vape ${sufijo}`,
        categoriaId: vapes.id,
        tieneVariantes: true,
        variantes: [{ nombre: "Uva", codigoBarras: codigos[1], precioCosto: 1, precioVenta: 2 }],
      }),
    ),
  );
  check(
    eDb instanceof DomainError &&
      JSON.stringify(eDb.fields ?? {}).includes("variantes.0.codigoBarras"),
    `código de otro producto (DB) → "${mensaje(eDb)}" (en el campo variantes.0.codigoBarras)`,
  );
  const eAlt = await error(() =>
    agregarCodigoAlternativo(actor, detalle.variantes[1]!.id, codigos[0]!, undefined),
  );
  check(
    mensaje(eAlt).includes(
      `El código ${codigos[0]} ya pertenece a Lost Mary ${sufijo} — Mango Ice`,
    ),
    `alternativo repetido → "${mensaje(eAlt)}"`,
  );

  // ---------------------------------------------------------------------------
  console.log(
    `\n2) Ingreso manual: 30 Mango Ice a ${g1.nombre} y 20 a ${g2.nombre} → 30 | 20 | 50`,
  );
  const mango = detalle.variantes.find((v) => v.nombre === "Mango Ice")!;
  await registrarIngresoManual(actor, {
    depositoId: g1.id,
    items: [{ varianteId: mango.id, cantidad: 30, costoUnitario: undefined }],
    motivo: "Carga inicial",
    actualizarCosto: false,
  });
  await registrarIngresoManual(actor, {
    depositoId: g2.id,
    items: [{ varianteId: mango.id, cantidad: 20, costoUnitario: 7200 }],
    motivo: "Carga inicial",
    actualizarCosto: true,
  });
  const filaInv = async () => {
    const r = await obtenerStock(actor, filtrosStockSchema.parse({ q: mango.codigoBarras! }));
    return r.filas.find((f) => f.varianteId === mango.id)!;
  };
  let inv = await filaInv();
  check(
    inv.porDeposito[g1.id] === 30 && inv.porDeposito[g2.id] === 20 && inv.total === 50,
    `stock: ${g1.nombre} ${inv.porDeposito[g1.id]} | ${g2.nombre} ${inv.porDeposito[g2.id]} | total ${inv.total}`,
  );
  const matriz = await obtenerStockPorProducto(actor, creado.id);
  const fm = matriz.filas.find((f) => f.varianteId === mango.id)!;
  check(
    fm.porDeposito[g1.id] === 30 && fm.porDeposito[g2.id] === 20 && fm.total === 50,
    "la matriz de la ficha coincide (30 | 20 | 50)",
  );
  const costoMango = (await db.variante.findUniqueOrThrow({ where: { id: mango.id } })).precioCosto;
  check(
    costoMango.toFixed(2) === "7200.00",
    `actualizarCosto: el costo pasó a ${costoMango.toFixed(2)}`,
  );

  // ---------------------------------------------------------------------------
  console.log(
    `\n3) Transferir 10 de ${g1.nombre} a ${g2.nombre} → 20 | 30 | 50; transferir 100 → falla`,
  );
  const t1 = await crearTransferencia(actor, {
    depositoOrigenId: g1.id,
    depositoDestinoId: g2.id,
    notas: undefined,
    items: [{ varianteId: mango.id, cantidad: 10 }],
  });
  check(
    (await db.transferencia.findUniqueOrThrow({ where: { id: t1.id } })).estado === "PENDIENTE",
    `transferencia #${t1.numero} creada PENDIENTE (no movió stock)`,
  );
  inv = await filaInv();
  check(
    inv.total === 50 && inv.porDeposito[g1.id] === 30,
    "mientras está pendiente el stock no cambia",
  );
  await completarTransferencia(actor, t1.id);
  inv = await filaInv();
  check(
    inv.porDeposito[g1.id] === 20 && inv.porDeposito[g2.id] === 30 && inv.total === 50,
    `completada: ${inv.porDeposito[g1.id]} | ${inv.porDeposito[g2.id]} | ${inv.total}`,
  );
  const e100 = await error(() =>
    crearTransferencia(actor, {
      depositoOrigenId: g1.id,
      depositoDestinoId: g2.id,
      notas: undefined,
      items: [{ varianteId: mango.id, cantidad: 100 }],
    }),
  );
  check(
    e100 instanceof DomainError && mensaje(e100).includes("hay 20, se piden 100"),
    `crear con 100 → "${mensaje(e100)}"`,
  );
  // Pendiente que se queda sin stock antes de completarse:
  const t2 = await crearTransferencia(actor, {
    depositoOrigenId: g1.id,
    depositoDestinoId: g2.id,
    notas: undefined,
    items: [{ varianteId: mango.id, cantidad: 15 }],
  });
  await registrarAjuste(actor, {
    depositoId: g1.id,
    varianteId: mango.id,
    cantidadReal: 5,
    motivo: "Rotura en depósito (test)",
  });
  const eComp = await error(() => completarTransferencia(actor, t2.id));
  const est2 = (await db.transferencia.findUniqueOrThrow({ where: { id: t2.id } })).estado;
  check(
    eComp instanceof DomainError && est2 === EstadoTransferencia.PENDIENTE,
    `completar #${t2.numero} sin stock → "${mensaje(eComp)}" (sigue ${est2})`,
  );
  await anularTransferencia(actor, t2.id, "Se rompieron en el depósito");
  check(
    (await db.transferencia.findUniqueOrThrow({ where: { id: t2.id } })).estado === "ANULADA",
    "la pendiente se puede anular",
  );
  const eAnular = await error(() => anularTransferencia(actor, t1.id, "no corresponde"));
  check(mensaje(eAnular).includes("solo se anulan las pendientes"), "una completada no se anula");
  const depCosmetic = await dbPara(COSMETIC).deposito.findFirstOrThrow({
    where: { esPrincipal: true },
  });
  const eCruzada = await error(() =>
    crearTransferencia(actor, {
      depositoOrigenId: g1.id,
      depositoDestinoId: depCosmetic.id,
      notas: undefined,
      items: [{ varianteId: mango.id, cantidad: 1 }],
    }),
  );
  check(eCruzada !== null, `transferir a un depósito de otro panel → "${mensaje(eCruzada)}"`);
  await registrarAjuste(actor, {
    depositoId: g1.id,
    varianteId: mango.id,
    cantidadReal: 20,
    motivo: "Recupero de unidades (test)",
  });

  // ---------------------------------------------------------------------------
  console.log("\n4) Recuento: sistema 20, conteo real 18 → AJUSTE_NEGATIVO por 2 y ledger 20 → 18");
  const recuento = await registrarAjusteMasivo(actor, {
    depositoId: g1.id,
    items: [
      { varianteId: mango.id, cantidadReal: 18 },
      { varianteId: detalle.variantes.find((v) => v.nombre === "Cola")!.id, cantidadReal: 0 },
    ],
    motivo: "Recuento mensual",
  });
  check(
    recuento.ajustes.length === 1 &&
      recuento.sinCambios === 1 &&
      recuento.ajustes[0]!.diferencia === -2,
    `recuento: ${recuento.ajustes.length} ajuste (dif ${recuento.ajustes[0]?.diferencia}), ${recuento.sinCambios} sin cambios`,
  );
  const ledger = await listarMovimientos(
    actor,
    listarMovimientosSchema.parse({
      varianteId: mango.id,
      depositoId: g1.id,
      page: 1,
      pageSize: 10,
    }),
  );
  const ult = ledger.movimientos[0]!;
  check(
    ult.tipo === TipoMovimiento.AJUSTE_NEGATIVO &&
      ult.cantidad === -2 &&
      ult.stockAnterior === 20 &&
      ult.stockPosterior === 18 &&
      ult.motivo === "Recuento mensual",
    `ledger: ${ult.tipo} ${ult.cantidad} · ${ult.stockAnterior} → ${ult.stockPosterior} · "${ult.motivo}"`,
  );
  const eSinDif = await error(() =>
    registrarAjuste(actor, {
      depositoId: g1.id,
      varianteId: mango.id,
      cantidadReal: 18,
      motivo: "otra vez lo mismo",
    }),
  );
  check(
    mensaje(eSinDif).includes("no hay nada que ajustar"),
    "ajustar al mismo valor → error claro",
  );

  // ---------------------------------------------------------------------------
  console.log("\n5) buscarPorCodigo");
  const conLog = process.env.PRISMA_LOG === "query";
  const queries: string[] = [];
  if (conLog) {
    (prisma as unknown as { $on: (e: "query", cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
      "query",
      (ev) => queries.push(ev.query),
    );
  }
  const encontrado = await buscarPorCodigo(
    actor,
    ` ${mango.codigoBarras!.slice(0, 6)} ${mango.codigoBarras!.slice(6)} `,
  );
  if (conLog) {
    const sql = queries.filter((q) => !/^(BEGIN|COMMIT|SELECT 1)/.test(q));
    check(sql.length === 1, `buscarPorCodigo ejecutó ${sql.length} query SQL`);
    console.log(`     SQL: ${sql[0]?.replace(/\s+/g, " ").slice(0, 1500)}`);
  }
  check(
    encontrado?.varianteId === mango.id && encontrado.stockTotal === 48,
    `encontró "${encontrado?.nombreCompleto}" · stock: ${encontrado?.stock.map((s) => `${s.deposito} ${s.cantidad}`).join(" | ")} | total ${encontrado?.stockTotal}`,
  );
  check(encontrado?.precioCosto === "7200.00", "con ctx de dueño trae el costo");
  const sinCosto = await buscarPorCodigo(vistaEmpleado, mango.codigoBarras!);
  check(
    sinCosto?.varianteId === mango.id && sinCosto.precioCosto === null,
    "con ctx de empleado, sin costo",
  );
  const alt = await agregarCodigoAlternativo(actor, mango.id, `alt-${sufijo}`, "Lote importador B");
  const porAlt = await buscarPorCodigo(actor, `ALT-${sufijo}`.toLowerCase());
  check(
    porAlt?.varianteId === mango.id && porAlt.porCodigoAlternativo,
    `por código alternativo en minúsculas ("${alt.codigo}") también la encuentra`,
  );
  check((await buscarPorCodigo(actor, "0000000000000")) === null, "código inexistente → null");

  // ---------------------------------------------------------------------------
  console.log("\n6) Códigos por panel: el mismo EAN en Cosmetic es otro producto");
  check(
    (await buscarPorCodigo({ panelId: COSMETIC }, mango.codigoBarras!)) === null,
    "desde Cosmetic, el EAN de Vapes no existe",
  );
  const dbCosmetic = dbPara(COSMETIC);
  const catCosmetic = await dbCosmetic.categoria.upsert({
    where: { panelId_nombre: { panelId: COSMETIC, nombre: `Test catálogo ${sufijo}` } },
    update: {},
    create: { nombre: `Test catálogo ${sufijo}` },
  });
  const ctxCosmetic = { ...actor, panelId: COSMETIC };
  const enCosmetic = await crearProducto(
    ctxCosmetic,
    productoSchema.parse({
      nombre: `Lost Mary ${sufijo}`,
      categoriaId: catCosmetic.id,
      tieneVariantes: false,
      variantes: [
        {
          nombre: "Único",
          codigoBarras: mango.codigoBarras,
          sku: mango.sku,
          precioCosto: 1,
          precioVenta: 2,
        },
      ],
    }),
  );
  const desdeCosmetic = await buscarPorCodigo(ctxCosmetic, mango.codigoBarras!);
  const desdeVapes = await buscarPorCodigo(actor, mango.codigoBarras!);
  check(
    desdeCosmetic?.productoId === enCosmetic.id && desdeVapes?.varianteId === mango.id,
    "mismo EAN y SKU en dos paneles: cada panel encuentra el suyo",
  );
  const eCatAjena = await error(() =>
    crearProducto(
      actor,
      productoSchema.parse({
        nombre: `Cruzado ${sufijo}`,
        categoriaId: catCosmetic.id,
        tieneVariantes: false,
        variantes: [{ nombre: "Único", precioCosto: 1, precioVenta: 2 }],
      }),
    ),
  );
  check(
    eCatAjena !== null,
    `producto de Vapes con una categoría de Cosmetic → "${mensaje(eCatAjena)}"`,
  );

  // ---------------------------------------------------------------------------
  console.log("\nExtra) Reglas de catálogo");
  const eDep = await error(() => cambiarActivoDeposito(actor, g2.id, false));
  check(
    eDep instanceof DomainError && /tiene \d+ unidades/.test(mensaje(eDep)),
    `desactivar depósito con stock → "${mensaje(eDep)}"`,
  );
  const eCat = await error(() => cambiarActivoClasificacion(actor, "Categoria", vapes.id, false));
  check(
    eCat instanceof DomainError && mensaje(eCat).includes("productos activos"),
    `desactivar categoría con productos → "${mensaje(eCat)}"`,
  );
  const aForm = (v: (typeof detalle.variantes)[number]) => ({
    id: v.id,
    nombre: v.nombre,
    sku: v.sku,
    codigoBarras: v.codigoBarras ?? undefined,
    precioCosto: v.precioCosto ?? undefined,
    precioVenta: v.precioVenta,
    stockMinimo: v.stockMinimo,
  });
  const sinMango = productoSchema.parse({
    nombre: detalle.nombre,
    categoriaId: vapes.id,
    marcaId: marca.id,
    tieneVariantes: true,
    variantes: detalle.variantes.filter((v) => v.nombre !== "Mango Ice").map(aForm),
  });
  const eQuitar = await error(() => actualizarProducto(actor, creado.id, sinMango));
  check(
    mensaje(eQuitar).includes("tiene 48 unidades en stock"),
    `quitar una variante con stock → "${mensaje(eQuitar)}"`,
  );
  const sinSandia = productoSchema.parse({
    ...sinMango,
    variantes: detalle.variantes.filter((v) => v.nombre !== "Sandía").map(aForm),
  });
  await actualizarProducto(actor, creado.id, sinSandia);
  const sandia = await db.variante.findFirstOrThrow({
    where: { productoId: creado.id, nombre: "Sandía" },
  });
  check(
    sandia.deletedAt !== null && !sandia.activo,
    "quitar una variante sin stock → soft delete (deletedAt + inactiva), nunca DELETE",
  );
  const listado = await listarProductos(actor, listarProductosSchema.parse({ q: codigos[3] }));
  check(
    listado.productos.length === 1 && listado.productos[0]!.id === creado.id,
    "listarProductos con un código exacto encuentra el producto",
  );
  const bajo = await listarProductos(
    actor,
    listarProductosSchema.parse({ conStockBajo: true, pageSize: 100 }),
  );
  check(
    bajo.productos.some((p) => p.id === creado.id),
    "filtro 'stock bajo' incluye al vape (sabores en 0 con mínimo 10)",
  );
  const listadoCosmetic = await listarProductos(
    { panelId: COSMETIC },
    listarProductosSchema.parse({ pageSize: 100 }),
  );
  check(
    listadoCosmetic.productos.every((p) => p.id !== creado.id),
    "el listado de Cosmetic no muestra productos de Vapes",
  );

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
