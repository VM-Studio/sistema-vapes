/**
 * Verificación del Prompt 3 a nivel servicios + DB (catálogo, inventario, movimientos).
 * Uso: pnpm test:catalogo   — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoTransferencia, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { generarEan13 } from "../src/lib/barcode";
import { prisma, withTransaction } from "../src/lib/db";
import { productoSchema } from "../src/lib/validations/producto";
import { DomainError } from "../src/server/errors";
import { cambiarActivoCategoria } from "../src/server/services/categoria.service";
import { cambiarActivoDeposito } from "../src/server/services/deposito.service";
import {
  obtenerStockConsolidado,
  obtenerStockPorProducto,
  filtrosInventarioSchema,
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
  aplicarAumentoPorcentual,
  buscarPorCodigo,
  calcularAumento,
  crearProducto,
  importarProductosCSV,
  listarProductos,
  obtenerProducto,
  previsualizarImportacion,
} from "../src/server/services/producto.service";

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
    where: { rol: RolUsuario.OWNER, email: "dueno1@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-catalogo" } };
  const [g1, g2] = await prisma.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");
  const vapes = await prisma.categoria.findFirstOrThrow({ where: { nombre: "Vapes" } });
  const marca = await prisma.marca.findFirstOrThrow({ where: { nombre: "Elf Bar" } });
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
  const creado = await crearProducto(input, actor);
  const detalle = await obtenerProducto(creado.id);
  check(
    detalle.variantes.length === 5,
    `producto creado con 5 variantes: ${detalle.variantes.map((v) => v.nombre).join(", ")}`,
  );
  check(
    detalle.variantes.every((v) => /^PRD-[A-Z2-9]{6}$/.test(v.sku)),
    `SKUs autogenerados con prefijo: ${detalle.variantes.map((v) => v.sku).join(", ")}`,
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
      productoSchema.parse({
        nombre: `Otro vape ${sufijo}`,
        categoriaId: vapes.id,
        tieneVariantes: true,
        variantes: [{ nombre: "Uva", codigoBarras: codigos[1], precioCosto: 1, precioVenta: 2 }],
      }),
      actor,
    ),
  );
  check(
    eDb instanceof DomainError &&
      JSON.stringify(eDb.fields ?? {}).includes("variantes.0.codigoBarras"),
    `código de otro producto (DB) → "${mensaje(eDb)}" (en el campo variantes.0.codigoBarras)`,
  );
  const eAlt = await error(() =>
    agregarCodigoAlternativo(detalle.variantes[1]!.id, codigos[0]!, undefined, actor),
  );
  check(
    mensaje(eAlt).includes(
      `El código ${codigos[0]} ya pertenece a Lost Mary ${sufijo} — Mango Ice`,
    ),
    `alternativo repetido → "${mensaje(eAlt)}"`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) CSV de 20 filas con 2 errores → no se inserta nada y el reporte marca las 2");
  const filas = [
    "producto;marca;categoria;variante;sku;codigo_barras;precio_costo;precio_venta;stock_minimo",
  ];
  for (let i = 1; i <= 20; i++) {
    const prod = `Import ${sufijo} ${Math.ceil(i / 4)}`;
    const codigo = generarEan13(`7797${sufijo}${String(i).padStart(2, "0")}`);
    let costo = "1.500,50";
    let cod = codigo;
    if (i === 7) costo = "mil pesos"; // error 1: precio inválido
    if (i === 15) cod = codigos[2]!; // error 2: código que ya existe (Lost Mary — Cola)
    filas.push(`${prod};Genérica;Líquidos importados;Sabor ${i};;${cod};${costo};2990;3`);
  }
  const csv = new TextEncoder().encode(filas.join("\r\n"));
  const productosAntes = await prisma.producto.count();
  const previa = await previsualizarImportacion(csv);
  const errores = previa.filas.filter((f) => f.estado === "error");
  check(
    previa.resumen.total === 20 && errores.length === 2,
    `previsualización: ${previa.resumen.ok} ok, ${errores.length} con error (separador "${previa.separador}", ${previa.encoding})`,
  );
  for (const e of errores) console.log(`     fila ${e.fila}: ${e.mensaje}`);
  check(
    errores.map((e) => e.fila).join(",") === "8,16",
    "las filas marcadas son la 8 y la 16 (datos 7 y 15 + encabezado)",
  );
  const intento = await importarProductosCSV(csv, actor);
  check(
    !intento.importado && (await prisma.producto.count()) === productosAntes,
    "importar con errores: no se insertó NADA (todo o nada)",
  );
  const corregido = new TextEncoder().encode(
    filas
      .map((l, i) =>
        i === 7
          ? l.replace("mil pesos", "1500")
          : i === 15
            ? l.replace(codigos[2]!, generarEan13(`7796${sufijo}15`))
            : l,
      )
      .join("\r\n"),
  );
  const ok = await importarProductosCSV(corregido, actor);
  check(
    ok.importado && ok.resumen.productosNuevos === 5 && ok.resumen.variantesNuevas === 20,
    `corregido: importado (${ok.resumen.productosNuevos} productos, ${ok.resumen.variantesNuevas} variantes)`,
  );
  check(
    (await prisma.categoria.count({ where: { nombre: "Líquidos importados" } })) === 1,
    "creó la categoría y la marca que no existían",
  );
  const previaLatin = await previsualizarImportacion(
    new Uint8Array([
      ...Buffer.from(
        `producto,categoria,precio_costo,precio_venta\nL\xEDquido ${sufijo},Accesorios,100,200\n`,
        "latin1",
      ),
    ]),
  );
  check(
    previaLatin.encoding === "windows-1252" &&
      previaLatin.separador === "," &&
      previaLatin.filas[0]?.producto === `Líquido ${sufijo}`,
    `detecta Latin-1 y "," (lee "${previaLatin.filas[0]?.producto}")`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Ingreso manual: 30 Mango Ice a Galpón 1 y 20 a Galpón 2 → 30 | 20 | 50");
  const mango = detalle.variantes.find((v) => v.nombre === "Mango Ice")!;
  await registrarIngresoManual(
    {
      depositoId: g1.id,
      items: [{ varianteId: mango.id, cantidad: 30, costoUnitario: undefined }],
      motivo: "Carga inicial",
      actualizarCosto: false,
    },
    actor,
  );
  await registrarIngresoManual(
    {
      depositoId: g2.id,
      items: [{ varianteId: mango.id, cantidad: 20, costoUnitario: 7200 }],
      motivo: "Carga inicial",
      actualizarCosto: true,
    },
    actor,
  );
  const filaInv = async () => {
    const r = await obtenerStockConsolidado(
      filtrosInventarioSchema.parse({ q: mango.codigoBarras! }),
      { incluirValorizacion: true },
    );
    return r.filas.find((f) => f.varianteId === mango.id)!;
  };
  let inv = await filaInv();
  check(
    inv.porDeposito[g1.id] === 30 && inv.porDeposito[g2.id] === 20 && inv.total === 50,
    `inventario: ${g1.nombre} ${inv.porDeposito[g1.id]} | ${g2.nombre} ${inv.porDeposito[g2.id]} | total ${inv.total}`,
  );
  const matriz = await obtenerStockPorProducto(creado.id);
  const fm = matriz.filas.find((f) => f.varianteId === mango.id)!;
  check(
    fm.porDeposito[g1.id] === 30 && fm.porDeposito[g2.id] === 20 && fm.total === 50,
    "la matriz de la ficha coincide (30 | 20 | 50)",
  );
  check(
    inv.valorizacion?.precioCosto === "7200.00",
    `actualizarCosto: el costo pasó a ${inv.valorizacion?.precioCosto} (con historial)`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Transferir 10 de Galpón 1 a Galpón 2 → 20 | 30 | 50; transferir 100 → falla");
  const t1 = await crearTransferencia(
    {
      depositoOrigenId: g1.id,
      depositoDestinoId: g2.id,
      notas: undefined,
      items: [{ varianteId: mango.id, cantidad: 10 }],
    },
    actor,
  );
  check(
    (await prisma.transferencia.findUniqueOrThrow({ where: { id: t1.id } })).estado === "PENDIENTE",
    `transferencia #${t1.numero} creada PENDIENTE (no movió stock)`,
  );
  inv = await filaInv();
  check(
    inv.total === 50 && inv.porDeposito[g1.id] === 30,
    "mientras está pendiente el stock no cambia",
  );
  await completarTransferencia(t1.id, actor);
  inv = await filaInv();
  check(
    inv.porDeposito[g1.id] === 20 && inv.porDeposito[g2.id] === 30 && inv.total === 50,
    `completada: ${inv.porDeposito[g1.id]} | ${inv.porDeposito[g2.id]} | ${inv.total}`,
  );
  const e100 = await error(() =>
    crearTransferencia(
      {
        depositoOrigenId: g1.id,
        depositoDestinoId: g2.id,
        notas: undefined,
        items: [{ varianteId: mango.id, cantidad: 100 }],
      },
      actor,
    ),
  );
  check(
    e100 instanceof DomainError && mensaje(e100).includes("hay 20, se piden 100"),
    `crear con 100 → "${mensaje(e100)}"`,
  );
  // Pendiente que se queda sin stock antes de completarse:
  const t2 = await crearTransferencia(
    {
      depositoOrigenId: g1.id,
      depositoDestinoId: g2.id,
      notas: undefined,
      items: [{ varianteId: mango.id, cantidad: 15 }],
    },
    actor,
  );
  await registrarAjuste(
    {
      depositoId: g1.id,
      varianteId: mango.id,
      cantidadReal: 5,
      motivo: "Rotura en depósito (test)",
    },
    actor,
  );
  const eComp = await error(() => completarTransferencia(t2.id, actor));
  const est2 = (await prisma.transferencia.findUniqueOrThrow({ where: { id: t2.id } })).estado;
  check(
    eComp instanceof DomainError && est2 === EstadoTransferencia.PENDIENTE,
    `completar #${t2.numero} sin stock → "${mensaje(eComp)}" (sigue ${est2})`,
  );
  await anularTransferencia(t2.id, "Se rompieron en el depósito", actor);
  check(
    (await prisma.transferencia.findUniqueOrThrow({ where: { id: t2.id } })).estado === "ANULADA",
    "la pendiente se puede anular",
  );
  const eAnular = await error(() => anularTransferencia(t1.id, "no corresponde", actor));
  check(mensaje(eAnular).includes("solo se anulan las pendientes"), "una completada no se anula");
  await registrarAjuste(
    {
      depositoId: g1.id,
      varianteId: mango.id,
      cantidadReal: 20,
      motivo: "Recupero de unidades (test)",
    },
    actor,
  );

  // ---------------------------------------------------------------------------
  console.log("\n5) Recuento: sistema 20, conteo real 18 → AJUSTE_NEGATIVO por 2 y ledger 20 → 18");
  const recuento = await registrarAjusteMasivo(
    {
      depositoId: g1.id,
      items: [
        { varianteId: mango.id, cantidadReal: 18 },
        { varianteId: detalle.variantes.find((v) => v.nombre === "Cola")!.id, cantidadReal: 0 },
      ],
      motivo: "Recuento mensual",
    },
    actor,
  );
  check(
    recuento.ajustes.length === 1 &&
      recuento.sinCambios === 1 &&
      recuento.ajustes[0]!.diferencia === -2,
    `recuento: ${recuento.ajustes.length} ajuste (dif ${recuento.ajustes[0]?.diferencia}), ${recuento.sinCambios} sin cambios`,
  );
  const ledger = await listarMovimientos({
    varianteId: mango.id,
    depositoId: g1.id,
    page: 1,
    pageSize: 1,
  });
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
    registrarAjuste(
      { depositoId: g1.id, varianteId: mango.id, cantidadReal: 18, motivo: "otra vez lo mismo" },
      actor,
    ),
  );
  check(
    mensaje(eSinDif).includes("no hay nada que ajustar"),
    "ajustar al mismo valor → error claro",
  );

  // ---------------------------------------------------------------------------
  console.log("\n6) buscarPorCodigo: una sola query (log de Prisma)");
  const queries: string[] = [];
  (prisma as unknown as { $on: (e: "query", cb: (ev: Prisma.QueryEvent) => void) => void }).$on(
    "query",
    (ev) => queries.push(ev.query),
  );
  queries.length = 0;
  const encontrado = await buscarPorCodigo(
    ` ${mango.codigoBarras!.slice(0, 6)} ${mango.codigoBarras!.slice(6)} `,
  );
  const sql = queries.filter((q) => !/^(BEGIN|COMMIT|SELECT 1)/.test(q));
  check(sql.length === 1, `buscarPorCodigo ejecutó ${sql.length} query SQL`);
  console.log(`     SQL: ${sql[0]?.replace(/\s+/g, " ").slice(0, 1500)}`);
  check(
    encontrado?.varianteId === mango.id && encontrado.stockTotal === 48,
    `encontró "${encontrado?.nombreCompleto}" · stock: ${encontrado?.stock.map((s) => `${s.deposito} ${s.cantidad}`).join(" | ")} | total ${encontrado?.stockTotal}`,
  );
  const alt = await agregarCodigoAlternativo(mango.id, `alt-${sufijo}`, "Lote importador B", actor);
  const porAlt = await buscarPorCodigo(`ALT-${sufijo}`.toLowerCase());
  check(
    porAlt?.varianteId === mango.id && porAlt.porCodigoAlternativo,
    `por código alternativo en minúsculas ("${alt.codigo}") también la encuentra`,
  );
  check((await buscarPorCodigo("0000000000000")) === null, "código inexistente → null");

  // ---------------------------------------------------------------------------
  console.log(
    "\n7) Aumento del 10% al precio de venta de la categoría Vapes → HistorialPrecio por variante",
  );
  const variantesVapes = await prisma.variante.findMany({
    where: { deletedAt: null, producto: { categoriaId: vapes.id, deletedAt: null } },
    select: { id: true, precioVenta: true },
  });
  const histAntes = await prisma.historialPrecio.count();
  const inicio = new Date();
  const { afectadas } = await aplicarAumentoPorcentual(
    {
      filtro: { categoriaId: vapes.id },
      porcentaje: 10,
      aplicarA: "venta",
      redondeo: 10,
      motivo: undefined,
    },
    actor,
  );
  const nuevasFilas = await prisma.historialPrecio.findMany({
    where: { createdAt: { gte: inicio } },
  });
  check(
    afectadas === variantesVapes.length &&
      nuevasFilas.length === variantesVapes.length &&
      (await prisma.historialPrecio.count()) - histAntes === afectadas,
    `${afectadas} variantes de Vapes → ${nuevasFilas.length} filas nuevas en HistorialPrecio`,
  );
  const ejemplo = variantesVapes.find((v) => v.id === mango.id)!;
  const despues = await prisma.variante.findUniqueOrThrow({ where: { id: mango.id } });
  check(
    despues.precioVenta.equals(calcularAumento(ejemplo.precioVenta, 10, 10)),
    `Mango Ice: ${ejemplo.precioVenta.toFixed(2)} → ${despues.precioVenta.toFixed(2)} (+10%, redondeo a $10)`,
  );
  check(
    nuevasFilas.every((h) => h.precioCostoAnterior.equals(h.precioCostoNuevo)),
    "el costo no se tocó (aplicarA: venta)",
  );

  // ---------------------------------------------------------------------------
  console.log("\nExtra) Reglas de catálogo");
  const ePrecioDirecto = await error(() =>
    withTransaction((tx) =>
      tx.variante.update({ where: { id: mango.id }, data: { precioVenta: 1 } }),
    ),
  );
  check(
    mensaje(ePrecioDirecto).includes("sin HistorialPrecio"),
    `UPDATE de precio sin historial → DB: "${mensaje(ePrecioDirecto)}"`,
  );
  const eDep = await error(() => cambiarActivoDeposito(g2.id, false, actor));
  check(
    eDep instanceof DomainError && /tiene \d+ unidades/.test(mensaje(eDep)),
    `desactivar depósito con stock → "${mensaje(eDep)}"`,
  );
  const eCat = await error(() => cambiarActivoCategoria(vapes.id, false, actor));
  check(
    eCat instanceof DomainError && mensaje(eCat).includes("productos activos"),
    `desactivar categoría con productos → "${mensaje(eCat)}"`,
  );
  const sinMango = productoSchema.parse({
    nombre: detalle.nombre,
    categoriaId: vapes.id,
    marcaId: marca.id,
    tieneVariantes: true,
    variantes: detalle.variantes
      .filter((v) => v.nombre !== "Mango Ice")
      .map((v) => ({
        ...v,
        precioCosto: v.precioCosto,
        precioVenta: v.precioVenta,
        codigoBarras: v.codigoBarras ?? undefined,
      })),
  });
  const eQuitar = await error(() => actualizarProducto(creado.id, sinMango, actor));
  check(
    mensaje(eQuitar).includes("tiene 48 unidades en stock"),
    `quitar una variante con stock → "${mensaje(eQuitar)}"`,
  );
  const sinSandia = productoSchema.parse({
    ...sinMango,
    variantes: detalle.variantes
      .filter((v) => v.nombre !== "Sandía")
      .map((v) => ({
        id: v.id,
        nombre: v.nombre,
        sku: v.sku,
        codigoBarras: v.codigoBarras ?? undefined,
        precioCosto: v.precioCosto,
        precioVenta: v.precioVenta,
        stockMinimo: v.stockMinimo,
      })),
  });
  await actualizarProducto(creado.id, sinSandia, actor);
  const sandia = await prisma.variante.findFirstOrThrow({
    where: { productoId: creado.id, nombre: "Sandía" },
  });
  check(
    sandia.deletedAt !== null && !sandia.activo,
    "quitar una variante sin stock → soft delete (deletedAt + inactiva), nunca DELETE",
  );
  const listado = await listarProductos({
    q: codigos[3],
    estado: "activos",
    conStockBajo: false,
    page: 1,
    pageSize: 20,
    orden: "nombre",
  });
  check(
    listado.productos.length === 1 && listado.productos[0]!.id === creado.id,
    "listarProductos con un código exacto encuentra el producto",
  );
  const bajo = await listarProductos({
    estado: "activos",
    conStockBajo: true,
    page: 1,
    pageSize: 100,
    orden: "nombre",
  });
  check(
    bajo.productos.some((p) => p.id === creado.id),
    "filtro 'stock bajo' incluye al vape (sabores en 0 con mínimo 10)",
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
