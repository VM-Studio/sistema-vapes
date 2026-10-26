/**
 * «Retirado», tarjetas de Stock (Disponible / Escaneado / Retirado), filtros
 * combinables (modelo, gusto, pitadas), lista única de productos en los dos
 * galpones y movimientos con texto fácil + retiros (panel Vapes).
 * Uso: pnpm test:retiro — pensado para una DB recién sembrada (crea datos).
 */
import { RolUsuario, TipoMovimiento } from "@prisma/client";

import { prisma } from "../src/lib/db";
import type { SujetoPermisos } from "../src/lib/permisos";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { productoSchema } from "../src/lib/validations/producto";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError, ForbiddenError } from "../src/server/errors";
import { confirmarEscaneo, pedirEscaneo } from "../src/server/services/escaneo-remoto.service";
import {
  exportarStockCSV,
  filtrosStockSchema,
  normalizarGusto,
  obtenerStock,
  opcionesFiltrosStock,
} from "../src/server/services/inventario.service";
import { listarMovimientos, registrarAjuste } from "../src/server/services/movimiento.service";
import { crear as crearProducto } from "../src/server/services/producto.service";
import { listarEscaneadasSinRetirar, marcarRetirada } from "../src/server/services/retiro.service";
import { anularVenta, generarVenta, listarVentas } from "../src/server/services/venta.service";
import { listarVentasSchema } from "../src/lib/validations/venta";

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
const TODOS = { porVentas: true, porEscaneo: false };

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const charly = await prisma.usuario.findFirstOrThrow({ where: { email: "charly@negocio.com" } });
  const meta = { ip: "127.0.0.1", userAgent: "test-retiro" };
  const ctx: Ctx & { usuario: SujetoPermisos } = {
    panelId: VAPES,
    usuarioId: owner.id,
    meta,
    usuario: { rol: RolUsuario.OWNER, permisos: [], paneles: [] },
  };
  const ctxCharly: Ctx = { panelId: VAPES, usuarioId: charly.id, meta };
  const ayres = await db.deposito.findFirstOrThrow({ where: { esPrincipal: true } });
  const mercedes = await db.deposito.findFirstOrThrow({ where: { escaneoRemoto: true } });
  const suf = String(Date.now()).slice(-7);

  // ---------------------------------------------------------------------------
  console.log("\n1) Lista única: un producto nuevo nace en 0 en los dos galpones");
  const marca = `Retiro ${suf}`;
  const creado = await crearProducto(
    ctx,
    productoSchema.parse({
      marca,
      modelo: `Pod R${suf}`,
      especificacion: "9000",
      precioVenta: 10000,
      sabores: [
        { sabor: "Mango Ice", codigoBarras: `RTM${suf}` },
        { sabor: "Uva", codigoBarras: `RTU${suf}` },
      ],
    }),
  );
  const [mango, uva] = [
    creado.variantes.find((v) => v.nombre === "Mango Ice")!,
    creado.variantes.find((v) => v.nombre === "Uva")!,
  ];
  const filasStock = await db.stock.findMany({ where: { varianteId: { in: [mango.id, uva.id] } } });
  check(
    filasStock.length === 4 && filasStock.every((f) => f.cantidad === 0),
    `filas de Stock en 0 en cada galpón (${filasStock.length})`,
  );
  const enMercedes = await obtenerStock(
    ctx,
    filtrosStockSchema.parse({ depositoId: mercedes.id, marcaId: undefined, q: `Pod R${suf}` }),
  );
  check(enMercedes.filas.length === 2, "en Mercedes aparecen los 2 sabores (con 0)");
  const marcaId = (await db.marca.findFirstOrThrow({ where: { nombre: marca } })).id;

  for (const v of [mango, uva])
    for (const d of [ayres, mercedes])
      await registrarAjuste(ctx, {
        depositoId: d.id,
        varianteId: v.id,
        cantidadReal: 10,
        motivo: "Preparación test-retiro",
      });

  // ---------------------------------------------------------------------------
  console.log("\n2) Venta en Mercedes con «Escanea Charly»: pendiente → escaneada → retirada");
  const cliente = await db.cliente.findFirstOrThrow({ where: { deletedAt: null } });
  const venta = (depositoId: string, escaneoRemoto: boolean, cantidad = 2) =>
    generarVentaSchema.parse({
      depositoId,
      cliente: { id: cliente.id },
      items: [{ varianteId: mango.id, cantidad }],
      pagos: [{ medioPago: "EFECTIVO", monto: 10000 * cantidad }],
      escaneoRemoto,
    });
  const v1 = await generarVenta(ctx, venta(mercedes.id, true), { puedeEditar: true });
  const fila1 = await db.venta.findUniqueOrThrow({ where: { id: v1.id } });
  check(fila1.retiradaAt === null, "una venta nueva queda pendiente de retiro");
  const f = (extra: Record<string, unknown> = {}) =>
    filtrosStockSchema.parse({ depositoId: mercedes.id, marcaId, ...extra });
  let r = await obtenerStock(ctx, f());
  const filaMango = () => r.filas.find((x) => x.varianteId === mango.id)!;
  check(
    filaMango().cantidad === 8 && filaMango().escaneado === 0 && filaMango().sinEscanear === 2,
    `pendiente de escaneo: disponible 8, escaneado 0, sin escanear 2 (${filaMango().cantidad}/${filaMango().escaneado}/${filaMango().sinEscanear})`,
  );
  const pendiente = await error(() => marcarRetirada(ctx, v1.id, TODOS));
  check(
    pendiente instanceof DomainError && /Falta que Charly la escanee/.test(msg(pendiente)),
    `con escaneo PENDIENTE no se retira → «${msg(pendiente)}»`,
  );
  const sinEscanearCharly = await error(() =>
    marcarRetirada(ctxCharly, v1.id, { porVentas: false, porEscaneo: true }),
  );
  check(sinEscanearCharly instanceof ForbiddenError, "Charly no retira una venta sin escanear");
  await confirmarEscaneo(ctxCharly, v1.id, [`RTM${suf}`, `RTM${suf}`]);
  r = await obtenerStock(ctx, f());
  check(
    filaMango().cantidad === 8 && filaMango().escaneado === 2 && filaMango().fisico === 10,
    "escaneada: disponible 8 · escaneado (reservado) 2 · físico 10",
  );
  check(
    r.totales.escaneado === 2 && r.totales.disponible === 18 && r.totales.fisico === 20,
    `tarjetas: disponible ${r.totales.disponible} · escaneado ${r.totales.escaneado} · físico ${r.totales.fisico}`,
  );
  const soloEsc = await obtenerStock(ctx, f({ ver: "escaneado" }));
  check(
    soloEsc.filas.length === 1 && soloEsc.filas[0]!.varianteId === mango.id,
    "tarjeta Escaneado como filtro: solo el sabor con escaneado > 0",
  );
  check(soloEsc.totales.disponible === 18, "los totales no cambian al tocar una tarjeta");
  const paraRetirar = await listarEscaneadasSinRetirar(ctxCharly);
  check(
    paraRetirar.some((x) => x.id === v1.id),
    "aparece en «Listas para retirar» (pantalla de Charly)",
  );
  const ret = await marcarRetirada(ctxCharly, v1.id, { porVentas: false, porEscaneo: true });
  const fila1b = await db.venta.findUniqueOrThrow({ where: { id: v1.id } });
  check(
    fila1b.retiradaAt?.getTime() === ret.retiradaAt.getTime() && fila1b.retiradaPorId === charly.id,
    "Charly la marca retirada (quién y cuándo)",
  );
  check(
    (await prisma.auditLog.count({
      where: {
        entidad: "Venta",
        entidadId: v1.id,
        datosDespues: { path: ["retirada"], equals: true },
      },
    })) === 1,
    "AuditLog del retiro",
  );
  r = await obtenerStock(ctx, f());
  check(
    filaMango().cantidad === 8 && filaMango().escaneado === 0 && filaMango().retirado === 2,
    "retirada: disponible 8 · escaneado 0 · retirado 2",
  );
  const dosVeces = await error(() => marcarRetirada(ctx, v1.id, TODOS));
  check(dosVeces instanceof DomainError, `no se retira dos veces → «${msg(dosVeces)}»`);
  const deshacer = await error(
    () =>
      prisma.$executeRaw`UPDATE "Venta" SET "retiradaAt" = NULL, "retiradaPorId" = NULL WHERE "id" = ${v1.id}`,
  );
  check(/ya está retirada/.test(msg(deshacer)), "la DB no deja deshacer el retiro (trigger)");

  // ---------------------------------------------------------------------------
  console.log("\n3) Venta en Ayres (sin escaneo): Retirado directo; anular una sin retirar");
  const v2 = await generarVenta(ctx, venta(ayres.id, false, 3), { puedeEditar: true });
  const listaPend = await listarVentas(
    ctx,
    listarVentasSchema.parse({ retiro: "pendiente", depositoId: ayres.id }),
    { verCostos: true },
  );
  check(
    listaPend.ventas.some((x) => x.id === v2.id && x.retiro.retiradaAt === null),
    "filtro «Pendientes de retiro» en la lista de ventas",
  );
  const sinPermiso = await error(() =>
    marcarRetirada(ctx, v2.id, { porVentas: false, porEscaneo: false }),
  );
  check(sinPermiso instanceof ForbiddenError, "sin permiso no se marca");
  await marcarRetirada(ctx, v2.id, TODOS);
  const listaRet = await listarVentas(
    ctx,
    listarVentasSchema.parse({ retiro: "retirada", depositoId: ayres.id }),
    { verCostos: true },
  );
  check(
    listaRet.ventas.some((x) => x.id === v2.id),
    "filtro «Retiradas»",
  );
  const v3 = await generarVenta(ctx, venta(ayres.id, false, 1), { puedeEditar: true });
  await anularVenta(ctx, v3.id, "Prueba anulación sin retirar");
  const anulada = await error(() => marcarRetirada(ctx, v3.id, TODOS));
  check(anulada instanceof DomainError, "una anulada no se retira");
  const rAyres = await obtenerStock(
    ctx,
    filtrosStockSchema.parse({ depositoId: ayres.id, marcaId }),
  );
  const mAyres = rAyres.filas.find((x) => x.varianteId === mango.id)!;
  check(
    mAyres.cantidad === 7 && mAyres.retirado === 3 && mAyres.sinEscanear === 0,
    `Ayres: disponible 7 (la anulada devolvió 1) · retirado 3 (${mAyres.cantidad}/${mAyres.retirado})`,
  );
  const global = await obtenerStock(ctx, filtrosStockSchema.parse({ marcaId }));
  const mGlobal = global.filas.find((x) => x.varianteId === mango.id)!;
  check(
    mGlobal.cantidad === 15 && mGlobal.retirado === 5,
    `Global: disponible 15 · retirado 5 (${mGlobal.cantidad}/${mGlobal.retirado})`,
  );
  const pedirRetirada = await error(() => pedirEscaneo(ctx, v2.id));
  check(pedirRetirada instanceof DomainError, "no se pide escaneo de una venta ya retirada");
  const check2 = await error(
    () => prisma.$executeRaw`UPDATE "Venta" SET "retiradaAt" = now() WHERE "id" = ${v3.id}`,
  );
  check(/anulada|venta_retiro/.test(msg(check2)), "la DB no deja retirar una anulada");

  // ---------------------------------------------------------------------------
  console.log("\n4) Filtros: modelo (de la marca), gusto y pitadas, combinables");
  const ops = await opcionesFiltrosStock(ctx, { marcaId });
  check(
    ops.modelos.length === 1 && ops.modelos[0]!.label === `Pod R${suf}`,
    "modelos de la marca elegida",
  );
  check(
    ops.gustos.some((g) => g.value === normalizarGusto("Mango Ice")) &&
      ops.pitadas.some((p) => p.value === "9000"),
    "gustos y pitadas del catálogo",
  );
  const porGusto = await obtenerStock(
    ctx,
    filtrosStockSchema.parse({ gusto: normalizarGusto("MANGO  ice"), pitadas: "9000", marcaId }),
  );
  check(
    porGusto.filas.length === 1 && porGusto.filas[0]!.varianteId === mango.id,
    "gusto + pitadas + marca combinados",
  );
  const porModelo = await obtenerStock(
    ctx,
    filtrosStockSchema.parse({ modelo: ops.modelos[0]!.value, depositoId: mercedes.id }),
  );
  check(porModelo.filas.length === 2, "modelo: todos sus sabores");
  const csv = await exportarStockCSV(
    ctx,
    filtrosStockSchema.parse({ modelo: ops.modelos[0]!.value, ver: "retirado" }),
  );
  const lineas = csv.trim().split(/\r?\n/);
  check(
    lineas.length === 2 && /Retirado/.test(lineas[0]!) && /Mango Ice/.test(lineas[1]!),
    "el CSV respeta modelo + tarjeta (1 sabor) y trae la columna Retirado",
  );

  // ---------------------------------------------------------------------------
  console.log("\n5) Movimientos: texto fácil, familias y retiros mezclados por fecha");
  const led = await listarMovimientos(ctx, { productoId: creado.id, page: 1, pageSize: 50 });
  const ventaMov = led.movimientos.find(
    (m) =>
      m.evento === "MOVIMIENTO" && m.tipo === TipoMovimiento.VENTA && m.referencia?.id === v1.id,
  );
  check(
    ventaMov !== undefined &&
      ventaMov.descripcion === `Venta ${v1.codigo} a ${cliente.nombre}` &&
      ventaMov.cantidad === -2,
    `«${ventaMov?.descripcion}» · ${ventaMov?.cantidad}`,
  );
  const retiro = led.movimientos.find((m) => m.evento === "RETIRO" && m.referencia?.id === v1.id);
  check(
    retiro !== undefined &&
      retiro.descripcion === `Retirado (venta ${v1.codigo} a ${cliente.nombre})` &&
      retiro.cantidad === 2 &&
      retiro.usuario === charly.nombre,
    `retiro informativo: «${retiro?.descripcion}»`,
  );
  const fechas = led.movimientos.map((m) => m.fecha.getTime());
  check(
    fechas.every((t, i) => i === 0 || fechas[i - 1]! >= t),
    "ordenados por fecha (más nuevos primero)",
  );
  const soloVentas = await listarMovimientos(ctx, {
    productoId: creado.id,
    familia: "ventas",
    page: 1,
    pageSize: 50,
  });
  check(
    soloVentas.movimientos.every(
      (m) =>
        m.evento === "RETIRO" ||
        m.tipo === TipoMovimiento.VENTA ||
        m.tipo === TipoMovimiento.VENTA_ANULADA,
    ) && soloVentas.movimientos.some((m) => m.evento === "RETIRO"),
    "familia «ventas»: ventas, anulaciones y retiros",
  );
  const soloAjustes = await listarMovimientos(ctx, {
    productoId: creado.id,
    familia: "ajustes",
    depositoId: mercedes.id,
    page: 1,
    pageSize: 50,
  });
  check(
    soloAjustes.total === 2 && soloAjustes.movimientos.every((m) => m.depositoId === mercedes.id),
    `familia «ajustes» + galpón: ${soloAjustes.total}`,
  );
  const porTexto = await listarMovimientos(ctx, { q: `R${suf} uva`, page: 1, pageSize: 50 });
  check(
    porTexto.total === 2 && porTexto.movimientos.every((m) => m.varianteId === uva.id),
    "búsqueda por producto y sabor",
  );
  const pag = await listarMovimientos(ctx, { productoId: creado.id, page: 2, pageSize: 3 });
  check(pag.total === led.total && pag.movimientos.length === 3, `paginado (total ${pag.total})`);
  const sinRet = await listarMovimientos(
    ctx,
    { productoId: creado.id, page: 1, pageSize: 50 },
    { incluirRetiros: false },
  );
  check(
    sinRet.total === led.total - 2 && sinRet.movimientos.every((m) => m.evento === "MOVIMIENTO"),
    "sin retiros: solo el ledger",
  );

  console.log(fallos ? `\n✘ ${fallos} verificaciones fallaron` : "\n✔ Todo OK");
  process.exitCode = fallos ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
