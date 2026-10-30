/**
 * Compras a nivel servicios + DB en el panel Vapes: proveedores (teléfono,
 * nombre de tienda, precios por producto), compras por sabor (proveedor y
 * galpón obligatorios, costo sugerido, recibir con último costo y precio del
 * proveedor, anular con devolución), recuento "Contar" (50 → 48), códigos
 * internos, PDF de etiquetas, aislamiento entre paneles, proveedores en USDT
 * y costo final (comisión del pasista + gastos extras por unidad).
 * Uso: pnpm test:compras — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoCompra, Moneda, RolUsuario, TipoMovimiento } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import { digitoLuhn, generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { formatearIdCompra } from "../src/lib/paneles";
import type { SujetoPermisos } from "../src/lib/permisos";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { compraSchema } from "../src/lib/validations/compra";
import { crearProveedorSchema } from "../src/lib/validations/proveedor";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../src/server/errors";
import {
  actualizarCompra,
  agregarGastosCompra,
  anularCompra,
  anularGastoCompra,
  cambiarComisionPasista,
  catalogoParaCompra,
  costoSugerido,
  crearCompra,
  obtenerCompra,
  preciosQueCambian,
  recibirCompra,
} from "../src/server/services/compra.service";
import { obtenerConfigCompras } from "../src/server/services/configuracion.service";
import {
  comisionesDeCompra,
  deshacerPago,
  detalle as detallePasista,
  listar as listarPasista,
  marcarPagadas,
  mesActualAR,
  totalesPasista,
} from "../src/server/services/pasista.service";
import {
  generarPdfEtiquetas,
  listarVariantesParaEtiquetas,
} from "../src/server/services/etiquetas.service";
import {
  registrarAjuste,
  registrarAjusteMasivo,
  registrarIngresoManual,
} from "../src/server/services/movimiento.service";
import {
  asignarCodigosInternos,
  buscarPorCodigo,
  esCodigoInterno,
  generarCodigoInterno,
  prefijoCodigoInterno,
} from "../src/server/services/producto.service";
import {
  asignarProducto,
  crear as crearProveedor,
  desactivar as desactivarProveedor,
  listar as listarProveedores,
  listarProveedoresActivos,
  ofertasParaCompra,
  proveedoresDeProducto,
} from "../src/server/services/proveedor.service";

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
const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const db = dbPara(VAPES);
const stockDe = async (varianteId: string, depositoId: string) =>
  (
    await db.stock.findUnique({
      where: { panelId_varianteId_depositoId: { panelId: VAPES, varianteId, depositoId } },
    })
  )?.cantidad ?? 0;

// Override manual de la cotización USDT (global): el test no depende de las APIs.
// Fuera de la sección USDT vale 1 → los costos cargados en USDT valen lo mismo en pesos.
const CLAVE_USDT = "cambio.overrideUSDT";
const fijarUsdt = (valor: number) =>
  prisma.configuracionGlobal.upsert({
    where: { clave: CLAVE_USDT },
    create: { clave: CLAVE_USDT, valor: { valor, cargadoAt: new Date().toISOString() } },
    update: { valor: { valor, cargadoAt: new Date().toISOString() } },
  });

async function main() {
  const overrideUsdtPrevio = await prisma.configuracionGlobal.findUnique({
    where: { clave: CLAVE_USDT },
  });
  try {
    await fijarUsdt(1);
    await pruebas();
  } finally {
    if (overrideUsdtPrevio)
      await prisma.configuracionGlobal.update({
        where: { clave: CLAVE_USDT },
        data: { valor: overrideUsdtPrevio.valor ?? {} },
      });
    else await prisma.configuracionGlobal.deleteMany({ where: { clave: CLAVE_USDT } });
  }
}

async function pruebas() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const actor: Ctx & { usuario: SujetoPermisos } = {
    panelId: VAPES,
    usuarioId: owner.id,
    meta: { ip: "127.0.0.1", userAgent: "test-compras" },
    usuario: { rol: owner.rol, permisos: [], paneles: [] },
  };
  const [g1, g2] = await db.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");
  const sufijo = String(Date.now()).slice(-6);

  // Catálogo propio: un vape con 3 sabores (Durazno sin compras todavía) y un
  // cargador sin sabor ni código (para los códigos internos).
  const { producto, cargadorId, fundaId } = await transaccion(actor, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Compras" } },
      update: {},
      create: { nombre: "Test Compras" },
    });
    const producto = await tx.producto.create({
      data: {
        marcaId: marca.id,
        nombre: `Vape ${sufijo}`,
        especificacion: "6000",
        precioVenta: "9000.00",
        variantes: {
          create: ["Uva", "Limón", "Durazno"].map((nombre, i) => ({
            nombre,
            sku: `TC-${sufijo}-${i}`,
            codigoBarras: generarEan13(`7797${sufijo}${String(i).padStart(2, "0")}`),
            ultimoCosto: nombre === "Durazno" ? null : "5000.00",
          })),
        },
      },
      include: { variantes: true },
    });
    const sinSabor = async (nombre: string, sku: string) =>
      (
        await tx.producto.create({
          data: {
            marcaId: marca.id,
            nombre,
            precioVenta: "2500.00",
            variantes: { create: [{ nombre: "Único", sku, ultimoCosto: "1000.00" }] },
          },
          include: { variantes: true },
        })
      ).variantes[0]!.id;
    return {
      producto,
      cargadorId: await sinSabor(`Cargador ${sufijo}`, `TC-${sufijo}-C`),
      fundaId: await sinSabor(`Funda ${sufijo}`, `TC-${sufijo}-F`),
    };
  });
  const porNombre = (n: string) => producto.variantes.find((v) => v.nombre === n);
  const [uva, limon, durazno] = [porNombre("Uva"), porNombre("Limón"), porNombre("Durazno")];
  if (!uva || !limon || !durazno) throw new Error("Faltan variantes");

  // ---------------------------------------------------------------------------
  console.log("\n1) Proveedores: tienda, teléfono único por panel, precios por producto");
  const tel = `11 ${sufijo}${String(Date.now()).slice(-2)}`;
  const prov = await crearProveedor(
    actor,
    crearProveedorSchema.parse({
      nombre: `Juan ${sufijo}`,
      nombreTienda: `Importadora ${sufijo}`,
      telefono: tel,
      productos: [{ productoId: producto.id, precio: "5100", moneda: "ARS" }],
    }),
  );
  const guardado = await prisma.proveedor.findUniqueOrThrow({ where: { id: prov.id } });
  check(
    guardado.telefono === `+54${tel.replace(/\D/g, "")}` &&
      guardado.nombreTienda === `Importadora ${sufijo}`,
    `teléfono guardado normalizado: ${guardado.telefono} · tienda ${guardado.nombreTienda}`,
  );
  const dup = await error(() =>
    crearProveedor(
      actor,
      crearProveedorSchema.parse({ nombre: "Otro", nombreTienda: "Otra", telefono: `+54 ${tel}` }),
    ),
  );
  check(
    dup instanceof ConflictError && Boolean(dup.fields?.telefono),
    `teléfono repetido → ConflictError en el campo telefono («${(dup as Error)?.message}»)`,
  );
  const barato = await crearProveedor(
    actor,
    crearProveedorSchema.parse({
      nombre: `Ana ${sufijo}`,
      nombreTienda: `Mayorista ${sufijo}`,
      productos: [{ productoId: producto.id, precio: "4900", moneda: "ARS" }],
    }),
  );
  const enDolares = await crearProveedor(
    actor,
    crearProveedorSchema.parse({ nombre: `Leo ${sufijo}`, nombreTienda: `Dólar ${sufijo}` }),
  );
  await asignarProducto(actor, enDolares.id, {
    productoId: producto.id,
    precio: 4,
    moneda: Moneda.USDT,
  });
  const comparador = await proveedoresDeProducto(actor, producto.id);
  const enPesos = comparador.filter((c) => c.moneda === Moneda.ARS);
  check(
    comparador.length === 3 &&
      comparador.some((c) => c.proveedorId === enDolares.id && c.moneda === Moneda.USDT) &&
      enPesos[0]?.proveedorId === barato.id &&
      enPesos[1]?.proveedorId === prov.id,
    `proveedores del producto por precio: ${comparador.map((c) => `${c.nombreTienda} ${c.moneda} ${c.precio}`).join(" < ")}`,
  );
  await asignarProducto(actor, barato.id, {
    productoId: producto.id,
    precio: 4950,
    moneda: Moneda.ARS,
  });
  const ppBarato = await db.proveedorProducto.findMany({
    where: { proveedorId: barato.id, productoId: producto.id },
  });
  check(
    ppBarato.length === 1 && ppBarato[0]!.precio.toFixed(2) === "4950.00",
    "asignar de nuevo el mismo producto actualiza el precio (una sola fila)",
  );
  check(
    (await listarProveedores(actor, { q: `Vape ${sufijo}` })).some((p) => p.id === prov.id),
    "buscar proveedores por el nombre de un producto que venden",
  );
  const provTemp = await crearProveedor(
    actor,
    crearProveedorSchema.parse({ nombre: `Temporal ${sufijo}`, nombreTienda: "Temporal" }),
  );
  await desactivarProveedor(actor, provTemp.id);
  check(
    !(await listarProveedoresActivos(actor)).some((p) => p.id === provTemp.id),
    "proveedor desactivado → no se ofrece para compras nuevas",
  );
  const eInactivo = await error(() =>
    crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: provTemp.id,
        depositoId: g1.id,
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitarioUSDT: 1 }],
      }),
    ),
  );
  check(
    eInactivo instanceof DomainError,
    `comprar a un proveedor inactivo → «${(eInactivo as Error)?.message}»`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Compra de 3 sabores: proveedor y galpón obligatorios, totales del servidor");
  const sinProveedor = compraSchema.safeParse({
    depositoId: g1.id,
    items: [{ varianteId: uva.id, cantidad: 1, costoUnitarioUSDT: 1 }],
  });
  check(
    !sinProveedor.success &&
      sinProveedor.error.issues.some((i) => i.path.join(".") === "proveedorId"),
    `compra sin proveedor → Zod: «${sinProveedor.error?.issues[0]?.message}»`,
  );
  const sugerido = await costoSugerido(actor, prov.id, [uva.id, durazno.id]);
  const sugeridoSinPrecio = await costoSugerido(actor, provTemp.id, [uva.id, durazno.id]);
  check(
    sugerido[uva.id]?.costo === "5100.00" &&
      sugerido[uva.id]?.fuente === "PROVEEDOR" &&
      sugeridoSinPrecio[uva.id]?.costo === "5000.00" &&
      sugeridoSinPrecio[uva.id]?.fuente === "ULTIMO_COSTO" &&
      sugeridoSinPrecio[durazno.id]?.costo === null,
    "costo sugerido: precio del proveedor → último costo del sabor → nada",
  );
  const datos = compraSchema.parse({
    proveedorId: prov.id,
    depositoId: g1.id,
    notas: "Remito 0001-000123",
    items: [
      { varianteId: uva.id, cantidad: 10, costoUnitarioUSDT: "5200" },
      { varianteId: limon.id, cantidad: 5, costoUnitarioUSDT: "4800.50" },
      { varianteId: durazno.id, cantidad: 3, costoUnitarioUSDT: "5000" },
    ],
  });
  const compra = await crearCompra(actor, datos);
  const idCompra = formatearIdCompra("vapes", compra.numero);
  let det = await obtenerCompra(actor, compra.id);
  // 10×5200 + 5×4800,50 + 3×5000 = 52000 + 24002,50 + 15000
  check(det.estado === EstadoCompra.BORRADOR, `compra ${idCompra} creada en BORRADOR`);
  check(
    det.subtotal === "91002.50" && det.total === "91002.50",
    `subtotal ${det.subtotal}, total ${det.total} (calculados por el servidor)`,
  );
  check(
    det.items.every((i) => i.productoId === producto.id) &&
      (await db.compraItem.count({ where: { compraId: compra.id, productoId: producto.id } })) ===
        3,
    "cada ítem guarda el producto de su sabor (CompraItem.productoId)",
  );
  check(
    det.items.every((i) => i.nombreCompleto === producto.nombreCompleto) &&
      det.items.map((i) => i.sabor).join() === "Uva,Limón,Durazno",
    `ítems con nombre completo y sabor: ${producto.nombreCompleto} — ${det.items.map((i) => i.sabor).join(", ")}`,
  );
  check(
    (await prisma.movimientoStock.count({ where: { referenciaId: compra.id } })) === 0,
    "el borrador no mueve stock",
  );

  // Editar el borrador: cambia cantidades.
  await actualizarCompra(actor, compra.id, {
    ...datos,
    items: datos.items.map((i) => (i.varianteId === durazno.id ? { ...i, cantidad: 4 } : i)),
  });
  det = await obtenerCompra(actor, compra.id);
  check(
    det.items.find((i) => i.varianteId === durazno.id)?.cantidad === 4 && det.total === "96002.50",
    `borrador editado: Durazno ×4, total ${det.total}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Recibir: último costo por sabor y precio del proveedor");
  const cambios = await preciosQueCambian(actor, compra.id);
  check(
    cambios.length === 1 && cambios[0]?.antes === "5100.00" && cambios[0].despues === "5000.00",
    `precio del proveedor que cambiaría: ${cambios.map((c) => `${c.nombreCompleto} ${c.antes} → ${c.despues}`).join(", ")} (gana el último ítem del producto)`,
  );
  const stocksAntes = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  const r = await recibirCompra(actor, compra.id, { actualizarPrecioProveedor: true });
  check(r.unidades === 19, `recibida: ${r.unidades} unidades`);
  const movs = await prisma.movimientoStock.findMany({
    where: { referenciaTipo: "COMPRA", referenciaId: compra.id },
    orderBy: { varianteId: "asc" },
  });
  check(
    movs.length === 3 && movs.every((m) => m.tipo === TipoMovimiento.INGRESO_COMPRA),
    `3 movimientos INGRESO_COMPRA con referencia COMPRA/${compra.id.slice(0, 8)}…`,
  );
  check(
    movs.every((m) => m.depositoId === g1.id && m.motivo === `Compra ${idCompra}`),
    `en el galpón de la compra, motivo «Compra ${idCompra}»`,
  );
  const stocksDespues = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  check(
    stocksDespues.join() ===
      [stocksAntes[0]! + 10, stocksAntes[1]! + 5, stocksAntes[2]! + 4].join(),
    `stock ${stocksAntes.join("/")} → ${stocksDespues.join("/")}`,
  );
  const variantes = await prisma.variante.findMany({
    where: { id: { in: [uva.id, limon.id, durazno.id] } },
  });
  const costo = (id: string) => variantes.find((v) => v.id === id)!.ultimoCosto?.toFixed(2);
  check(
    costo(uva.id) === "5200.00" && costo(limon.id) === "4800.50" && costo(durazno.id) === "5000.00",
    `ultimoCosto por sabor: Uva ${costo(uva.id)}, Limón ${costo(limon.id)}, Durazno ${costo(durazno.id)} (antes sin costo)`,
  );
  const pp = await db.proveedorProducto.findFirstOrThrow({
    where: { proveedorId: prov.id, productoId: producto.id },
  });
  check(
    r.preciosActualizados === 1 && pp.precio.toFixed(2) === "5000.00" && pp.usuarioId === owner.id,
    `precio del proveedor actualizado: ${pp.precio.toFixed(2)} (${r.preciosActualizados} producto)`,
  );
  const otraVez = await error(() =>
    recibirCompra(actor, compra.id, { actualizarPrecioProveedor: false }),
  );
  check(
    otraVez instanceof DomainError && /ya fue recibida/.test(otraVez.message),
    `recibir de nuevo → DomainError: ${(otraVez as Error)?.message}`,
  );
  const congelada = await error(() => actualizarCompra(actor, compra.id, datos));
  check(
    congelada instanceof DomainError,
    `editar una compra recibida → rechazado: ${(congelada as Error)?.message}`,
  );
  const itemDirecto = await error(() =>
    prisma.compraItem.updateMany({ where: { compraId: compra.id }, data: { cantidad: 99 } }),
  );
  check(
    itemDirecto !== null,
    "modificar ítems de una compra recibida directo en la DB → rechazado por trigger",
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Anular la compra recibida → DEVOLUCION_PROVEEDOR y el stock vuelve");
  const an = await anularCompra(actor, compra.id, "Mercadería con falla");
  const devs = await prisma.movimientoStock.findMany({
    where: { referenciaId: compra.id, tipo: TipoMovimiento.DEVOLUCION_PROVEEDOR },
  });
  check(an.devoluciones === 3 && devs.length === 3, `3 movimientos DEVOLUCION_PROVEEDOR`);
  const stocksFinal = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  check(stocksFinal.join() === stocksAntes.join(), `stock vuelve a ${stocksFinal.join("/")}`);
  det = await obtenerCompra(actor, compra.id);
  check(
    det.estado === EstadoCompra.ANULADA && /\[Anulada\] Mercadería con falla/.test(det.notas ?? ""),
    "estado ANULADA y motivo en las notas",
  );
  check(
    (await error(() => anularCompra(actor, compra.id, "otra vez"))) instanceof DomainError,
    "anular de nuevo → DomainError",
  );
  const audit = await prisma.auditLog.count({ where: { entidad: "Compra", entidadId: compra.id } });
  check(audit === 4, `AuditLog de la compra: ${audit} (crear, editar, recibir, anular)`);

  // ---------------------------------------------------------------------------
  console.log("\n5) Anular sin stock suficiente → falla completa, nada se mueve");
  const c2 = await crearCompra(
    actor,
    compraSchema.parse({
      proveedorId: prov.id,
      depositoId: g2.id,
      items: [
        { varianteId: uva.id, cantidad: 5, costoUnitarioUSDT: 5300 },
        { varianteId: limon.id, cantidad: 2, costoUnitarioUSDT: 4800.5 },
      ],
    }),
  );
  await recibirCompra(actor, c2.id, { actualizarPrecioProveedor: false });
  check(
    (
      await db.proveedorProducto.findFirstOrThrow({
        where: { proveedorId: prov.id, productoId: producto.id },
      })
    ).precio.toFixed(2) === "5000.00" &&
      (await db.variante.findUniqueOrThrow({ where: { id: uva.id } })).ultimoCosto?.toFixed(2) ===
        "5300.00",
    "recibir sin «actualizar precio del proveedor»: el precio queda, el último costo cambia",
  );
  await registrarAjuste(actor, {
    depositoId: g2.id,
    varianteId: uva.id,
    cantidadReal: 1,
    motivo: "Se vendieron (test)",
  });
  const e2 = await error(() => anularCompra(actor, c2.id, "Error de carga"));
  check(
    e2 instanceof DomainError && /Uva: hay 1, se devuelven 5/.test((e2 as Error).message),
    `DomainError con el detalle: ${(e2 as Error)?.message}`,
  );
  check(
    (await obtenerCompra(actor, c2.id)).estado === EstadoCompra.RECIBIDA &&
      (await stockDe(limon.id, g2.id)) === 2,
    "la compra sigue RECIBIDA y el Limón no se devolvió",
  );
  const c3 = await crearCompra(
    actor,
    compraSchema.parse({
      proveedorId: prov.id,
      depositoId: g1.id,
      items: [{ varianteId: uva.id, cantidad: 1, costoUnitarioUSDT: 1 }],
    }),
  );
  const an3 = await anularCompra(actor, c3.id, "Borrador duplicado");
  check(an3.devoluciones === 0, "anular un borrador no mueve stock");

  // ---------------------------------------------------------------------------
  console.log("\n6) Modo Contar: sistema 50, escaneados 48 → AJUSTE_NEGATIVO de 2");
  const actual = await stockDe(durazno.id, g2.id);
  if (actual < 50)
    await registrarIngresoManual(actor, {
      depositoId: g2.id,
      motivo: "Preparar recuento (test)",
      actualizarCosto: false,
      items: [{ varianteId: durazno.id, cantidad: 50 - actual }],
    });
  check((await stockDe(durazno.id, g2.id)) === 50, `Durazno en ${g2.nombre}: 50 en sistema`);
  const recuento = await registrarAjusteMasivo(actor, {
    depositoId: g2.id,
    motivo: "Recuento con escáner",
    items: [{ varianteId: durazno.id, cantidadReal: 48 }],
  });
  const ajuste = await prisma.movimientoStock.findFirst({
    where: { varianteId: durazno.id, depositoId: g2.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    recuento.ajustes.length === 1 &&
      ajuste?.tipo === TipoMovimiento.AJUSTE_NEGATIVO &&
      ajuste.cantidad === 2,
    `movimiento ${ajuste?.tipo} de ${ajuste?.cantidad}`,
  );
  check((await stockDe(durazno.id, g2.id)) === 48, "stock final 48");

  // ---------------------------------------------------------------------------
  console.log("\n7) Código interno {prefijo}{7 dígitos}{verificador} y etiquetas Code128");
  const prefijo = await prefijoCodigoInterno(actor);
  const muestra = await generarCodigoInterno(actor);
  const m = new RegExp(`^${prefijo}(\\d{7})(\\d)$`).exec(muestra);
  check(
    m !== null && digitoLuhn(m[1]!) === Number(m[2]),
    `generado: ${muestra} (verificador mod 10 OK)`,
  );
  check(
    esCodigoInterno(muestra, prefijo) &&
      !esCodigoInterno(`${prefijo}${m![1]}${(Number(m![2]) + 1) % 10}`, prefijo),
    "esCodigoInterno distingue un verificador inválido",
  );
  const cargador = { id: cargadorId };
  check(
    (await listarVariantesParaEtiquetas(actor, { soloSinCodigoDeFabrica: true })).some(
      (v) => v.varianteId === cargador.id,
    ),
    "«sin código de fábrica» incluye al cargador",
  );
  const pdf = await generarPdfEtiquetas(
    actor,
    { formato: "avery65", mostrarPrecio: true, items: [{ varianteId: cargador.id, cantidad: 6 }] },
    { puedeGenerarCodigos: true },
  );
  const asignado = (await prisma.variante.findUniqueOrThrow({ where: { id: cargador.id } }))
    .codigoBarras;
  check(
    pdf.etiquetas === 6 && pdf.codigosGenerados === 1 && esCodigoInterno(asignado, prefijo),
    `PDF con ${pdf.etiquetas} etiquetas; código asignado ${asignado}`,
  );
  const doc = await PDFDocument.load(pdf.pdf);
  const [ancho, alto] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  check(
    doc.getPageCount() === 1 && Math.round(ancho) === 595 && Math.round(alto) === 842,
    `1 página A4 (${ancho.toFixed(0)}×${alto.toFixed(0)} pt)`,
  );
  const encontrado = await buscarPorCodigo(actor, asignado!);
  check(
    encontrado?.varianteId === cargador.id,
    "el código interno se resuelve con buscarPorCodigo",
  );
  check(
    (await asignarCodigosInternos(actor, [cargador.id])).asignados.length === 0,
    "asignar de nuevo no pisa el código existente",
  );
  const e7 = await error(() =>
    generarPdfEtiquetas(
      actor,
      {
        formato: "rollo50x30",
        mostrarPrecio: false,
        items: [{ varianteId: fundaId, cantidad: 1 }],
      },
      { puedeGenerarCodigos: false },
    ),
  );
  check(
    e7 instanceof DomainError,
    `sin permiso para generar códigos → DomainError: ${(e7 as Error)?.message}`,
  );
  for (const formato of ["a4_3x8", "a4_2x7", "rollo50x30"] as const) {
    const p = await PDFDocument.load(
      (
        await generarPdfEtiquetas(
          actor,
          { formato, mostrarPrecio: true, items: [{ varianteId: uva.id, cantidad: 30 }] },
          { puedeGenerarCodigos: true },
        )
      ).pdf,
    );
    const esperadas = { a4_3x8: 2, a4_2x7: 3, rollo50x30: 30 }[formato];
    check(
      p.getPageCount() === esperadas,
      `formato ${formato}: 30 etiquetas → ${p.getPageCount()} página(s)`,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n8) Aislamiento entre paneles");
  const ctxCosmetic: Ctx = { panelId: COSMETIC, usuarioId: owner.id };
  const depCosmetic = await dbPara(COSMETIC).deposito.findFirstOrThrow({
    where: { esPrincipal: true },
  });
  const provCosmetic = await crearProveedor(
    ctxCosmetic,
    crearProveedorSchema.parse({
      nombre: `Juan ${sufijo}`,
      nombreTienda: `Importadora ${sufijo}`,
      telefono: tel,
    }),
  );
  check(provCosmetic.id !== prov.id, "el mismo teléfono puede ser de un proveedor de otro panel");
  const eLeer = await error(() => obtenerCompra(ctxCosmetic, compra.id));
  check(eLeer instanceof NotFoundError, "leer una compra de Vapes desde Cosmetic → no existe");
  const eAnular = await error(() => anularCompra(ctxCosmetic, c2.id, "intruso"));
  check(eAnular instanceof NotFoundError, "anular una compra de Vapes desde Cosmetic → no existe");
  const eCruzada = await error(() =>
    crearCompra(
      ctxCosmetic,
      compraSchema.parse({
        proveedorId: provCosmetic.id,
        depositoId: depCosmetic.id,
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitarioUSDT: 1 }],
      }),
    ),
  );
  check(
    eCruzada instanceof NotFoundError,
    `comprar en Cosmetic un sabor de Vapes → «${(eCruzada as Error)?.message}»`,
  );
  const eProv = await error(() =>
    crearCompra(
      ctxCosmetic,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: depCosmetic.id,
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitarioUSDT: 1 }],
      }),
    ),
  );
  check(
    eProv instanceof NotFoundError,
    `proveedor de Vapes en una compra de Cosmetic → «${(eProv as Error)?.message}»`,
  );
  const ePrecio = await error(() =>
    asignarProducto(ctxCosmetic, provCosmetic.id, {
      productoId: producto.id,
      precio: 1,
      moneda: Moneda.ARS,
    }),
  );
  check(
    ePrecio instanceof NotFoundError,
    `precio de un proveedor de Cosmetic para un producto de Vapes → «${(ePrecio as Error)?.message}»`,
  );
  check(
    !(await listarProveedoresActivos(ctxCosmetic)).some((p) => p.id === prov.id) &&
      (await proveedoresDeProducto(ctxCosmetic, producto.id)).length === 0,
    "los proveedores y precios de Vapes no aparecen en Cosmetic",
  );

  // ---------------------------------------------------------------------------
  console.log(
    "\n9) Compras en USDT: costo sugerido, catálogo, conversión a pesos y proveedor nuevo",
  );
  check(
    crearProveedorSchema.parse({
      nombre: "X",
      nombreTienda: "Y",
      productos: [{ productoId: producto.id, precio: "1" }],
    }).productos[0]?.moneda === Moneda.USDT,
    "precio de proveedor sin moneda → USDT por defecto",
  );
  await fijarUsdt(1300);
  try {
    const sug = await costoSugerido(actor, enDolares.id, [uva.id]);
    check(
      sug[uva.id]?.fuente === "PROVEEDOR_USDT" &&
        sug[uva.id]?.costo === "4.00" &&
        sug[uva.id]?.pesos === undefined,
      `precio del proveedor 4 USDT → costo sugerido ${sug[uva.id]?.costo} USDT (${sug[uva.id]?.fuente}), sin pasar por pesos`,
    );
    // Catálogo del proveedor y comparador por producto en el formulario de compra.
    const catalogo = await catalogoParaCompra(actor, enDolares.id, { depositoId: g1.id });
    const enCatalogo = catalogo.find((p) => p.productoId === producto.id);
    const stockUva = await stockDe(uva.id, g1.id);
    check(
      enCatalogo?.moneda === Moneda.USDT &&
        enCatalogo.precio === "4.00" &&
        enCatalogo.costoUsdt === "4.00" &&
        enCatalogo.tipoCambio === null &&
        enCatalogo.sabores.length === 3 &&
        enCatalogo.sabores.find((s) => s.varianteId === uva.id)?.stock === stockUva,
      `catálogo de ${enDolares.nombre}: ${enCatalogo?.precio} USDT → precarga ${enCatalogo?.costoUsdt} USDT, ${enCatalogo?.sabores.length} sabores con stock del galpón`,
    );
    const { productos: comparados } = await ofertasParaCompra(actor, [producto.id], enDolares.id);
    const cmp = comparados[producto.id];
    const pesos = (o: { precio: string; moneda: string }) =>
      o.moneda === "USDT" ? Number(o.precio) * 1300 : Number(o.precio);
    const ordenado = (cmp?.ofertas ?? []).every(
      (o, i, a) => i === 0 || pesos(a[i - 1]!) <= pesos(o),
    );
    const ofertaLeo = cmp?.ofertas.find((o) => o.proveedorId === enDolares.id);
    check(
      Boolean(cmp) &&
        cmp!.ofertas.length === 3 &&
        ordenado &&
        ofertaLeo?.esActual === true &&
        ofertaLeo.precioArsEquivalente === "5200.00" &&
        cmp!.actual?.proveedorId === enDolares.id &&
        cmp!.masBarato?.proveedorId === cmp!.ofertas[0]?.proveedorId &&
        cmp!.ofertas.filter((o) => o.esActual).length === 1,
      `comparador en la compra: ${cmp?.ofertas.map((o) => `${o.proveedor} ${o.precio} ${o.moneda}`).join(" < ")}`,
    );
    const otroPanel = await ofertasParaCompra({ panelId: COSMETIC }, [producto.id], null);
    check(
      (otroPanel.productos[producto.id]?.ofertas.length ?? 0) === 0 &&
        (await catalogoParaCompra({ ...actor, panelId: COSMETIC }, enDolares.id)).length === 0,
      "catálogo y comparador no cruzan paneles",
    );
    // La compra se carga EN USDT: los pesos salen de USDT × cotización (a centavos, sin redondear a pesos).
    const cUsdt = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: enDolares.id,
        depositoId: g1.id,
        items: [
          { varianteId: uva.id, cantidad: 2, costoUnitarioUSDT: "4" },
          { varianteId: limon.id, cantidad: 1, costoUnitarioUSDT: "4.5" },
        ],
      }),
    );
    const det = await obtenerCompra(actor, cUsdt.id);
    check(
      det.costosEnUsdt &&
        det.tipoCambioUSDT === "1300.00" &&
        det.items.find((i) => i.varianteId === uva.id)?.costoUnitarioUSDT === "4.00" &&
        det.items.find((i) => i.varianteId === uva.id)?.costoUnitario === "5200.00" &&
        det.items.find((i) => i.varianteId === limon.id)?.costoUnitarioUSDT === "4.50" &&
        det.items.find((i) => i.varianteId === limon.id)?.costoUnitario === "5850.00" &&
        det.total === "16250.00",
      `en USDT: cotización ${det.tipoCambioUSDT}, costos ${det.items.map((i) => `${i.costoUnitarioUSDT} USDT = $ ${i.costoUnitario}`).join(" / ")}, total $ ${det.total}`,
    );
    // Editar la compra con otra cotización vigente conserva la suya.
    await fijarUsdt(1500);
    await actualizarCompra(
      actor,
      cUsdt.id,
      compraSchema.parse({
        proveedorId: enDolares.id,
        depositoId: g1.id,
        items: [
          { varianteId: uva.id, cantidad: 2, costoUnitarioUSDT: "4" },
          { varianteId: limon.id, cantidad: 1, costoUnitarioUSDT: "4.5" },
        ],
      }),
    );
    const editada = await obtenerCompra(actor, cUsdt.id);
    check(
      editada.tipoCambioUSDT === "1300.00" && editada.total === "16250.00",
      "editar la compra conserva su cotización (los pesos no cambian)",
    );
    const cambiosUsdt = await preciosQueCambian(actor, cUsdt.id);
    check(
      cambiosUsdt.length === 1 &&
        cambiosUsdt[0]?.monedaAntes === Moneda.USDT &&
        cambiosUsdt[0]?.monedaDespues === Moneda.USDT &&
        cambiosUsdt[0]?.antes === "4.00" &&
        cambiosUsdt[0]?.despues === "4.50",
      `recibir: el precio en USDT del proveedor cambiaría ${cambiosUsdt[0]?.antes} → ${cambiosUsdt[0]?.despues} ${cambiosUsdt[0]?.monedaDespues}`,
    );
    await recibirCompra(actor, cUsdt.id, { actualizarPrecioProveedor: true });
    const ppUsdt = await db.proveedorProducto.findFirstOrThrow({
      where: { proveedorId: enDolares.id, productoId: producto.id },
    });
    check(
      ppUsdt.moneda === Moneda.USDT && ppUsdt.precio.toFixed(2) === "4.50",
      `precio del proveedor actualizado en USDT: ${ppUsdt.precio.toFixed(2)} ${ppUsdt.moneda}`,
    );

    // El caso del reclamo: proveedor NUEVO (sin precios), se tipea 8,30 de costo.
    // Antes se tomaba como $ 8,30 (≈ 0,01 USDT); ahora son 8,30 USDT.
    await fijarUsdt(1641.4);
    const nuevo = await crearProveedor(
      actor,
      crearProveedorSchema.parse({ nombre: `Nuevo ${sufijo}`, nombreTienda: "Sin precios" }),
    );
    // Sin precio del proveedor: el último costo (en pesos) ÷ cotización, a centavos.
    const { pesosAMoneda } = await import("../src/lib/costos-compra");
    const uvaAhora = await db.variante.findUniqueOrThrow({ where: { id: uva.id } });
    const sinPrecio = await costoSugerido(actor, nuevo.id, [uva.id]);
    check(
      sinPrecio[uva.id]?.fuente === "ULTIMO_COSTO" &&
        sinPrecio[uva.id]?.tipoCambio === "1641.40" &&
        sinPrecio[uva.id]?.pesos === uvaAhora.ultimoCosto?.toFixed(2) &&
        sinPrecio[uva.id]?.costo ===
          pesosAMoneda(uvaAhora.ultimoCosto!.toFixed(2), 1641.4).toFixed(2),
      `proveedor sin precio: último costo $ ${sinPrecio[uva.id]?.pesos} ÷ ${sinPrecio[uva.id]?.tipoCambio} = ${sinPrecio[uva.id]?.costo} USDT`,
    );
    const cNuevo = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: nuevo.id,
        depositoId: g1.id,
        comisionPasistaPorcentaje: "10",
        items: [
          { varianteId: uva.id, cantidad: 5, costoUnitarioUSDT: "8.3" },
          { varianteId: limon.id, cantidad: 10, costoUnitarioUSDT: "8" },
        ],
      }),
    );
    await agregarGastosCompra(actor, cNuevo.id, [{ motivo: "Valija", montoUSDT: 3 }]);
    const n = await obtenerCompra(actor, cNuevo.id);
    const uvaN = n.items.find((i) => i.varianteId === uva.id)!;
    const limonN = n.items.find((i) => i.varianteId === limon.id)!;
    // 8,30 × 1.641,40 = 13.623,62 · 8 × 1.641,40 = 13.131,20.
    // En USDT: subtotal 121,50 · pasista 12,15 · gastos 3 ÷ 15 u. = 0,20 c/u.
    // Uva: 8,30 + 0,83 + 0,20 = 9,33 USDT → $ 13.623,62 + (1,03 × 1.641,40 = 1.690,64) = $ 15.314,26.
    // Limón: 8 + 0,80 + 0,20 = 9,00 USDT → $ 13.131,20 + (1 × 1.641,40) = $ 14.772,60.
    check(
      uvaN.costoUnitarioUSDT === "8.30" &&
        uvaN.costoUnitario === "13623.62" &&
        limonN.costoUnitario === "13131.20" &&
        uvaN.costoUnitarioFinal === "15314.26" &&
        limonN.costoUnitarioFinal === "14772.60" &&
        n.gastos[0]?.montoUSDT === "3.00" &&
        n.gastos[0]?.monto === "4924.20",
      `proveedor nuevo, 8,30 USDT → $ ${uvaN.costoUnitario}; final Uva $ ${uvaN.costoUnitarioFinal}, Limón $ ${limonN.costoUnitarioFinal}; gasto 3 USDT = $ ${n.gastos[0]?.monto}`,
    );
    const { vistaCostosUsdt } = await import("../src/lib/costos-compra");
    const vista = vistaCostosUsdt({
      costosEnUsdt: n.costosEnUsdt,
      tipoCambioUSDT: n.tipoCambioUSDT!,
      comisionPorcentaje: n.comisionPasistaPorcentaje,
      descuento: n.descuento,
      items: n.items,
      gastos: n.gastos,
    });
    check(
      !vista.aproximado &&
        vista.costos.total === 121.5 &&
        vista.costos.comision === 12.15 &&
        vista.costos.gastos === 3 &&
        vista.costos.costoFinalTotal === 136.65 &&
        vista.finalesUsdt.join(" / ") === "9.33 / 9",
      `vista en USDT: total ${vista.costos.total}, pasista ${vista.costos.comision}, gastos ${vista.costos.gastos}, final ${vista.costos.costoFinalTotal}, por unidad ${vista.finalesUsdt.join(" / ")}`,
    );
    await recibirCompra(actor, cNuevo.id, { actualizarPrecioProveedor: true });
    const ppNuevo = await db.proveedorProducto.findFirstOrThrow({
      where: { proveedorId: nuevo.id, productoId: producto.id },
    });
    check(
      ppNuevo.moneda === Moneda.USDT && ppNuevo.precio.toFixed(2) === "8.00",
      `el proveedor nuevo queda con precio en USDT: ${ppNuevo.precio.toFixed(2)} ${ppNuevo.moneda}`,
    );
  } finally {
    await fijarUsdt(1);
  }

  // ---------------------------------------------------------------------------
  console.log("\n10) Costo final: comisión del pasista + gastos extras prorrateados por unidad");
  {
    const cf = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: g1.id,
        comisionPasistaPorcentaje: "10",
        items: [{ varianteId: limon.id, cantidad: 100, costoUnitarioUSDT: "10000" }],
      }),
    );
    let c = await obtenerCompra(actor, cf.id);
    check(
      c.comisionPasistaMonto === "100000.00" && c.costoFinalTotal === "1100000.00",
      `100 u. × $10.000 con 10% → comisión ${c.comisionPasistaMonto}, costo final ${c.costoFinalTotal}`,
    );
    await recibirCompra(actor, cf.id, { actualizarPrecioProveedor: false });
    const limonRecibido = await db.variante.findUniqueOrThrow({ where: { id: limon.id } });
    check(
      limonRecibido.ultimoCosto?.toFixed(2) === "11000.00",
      `recibir pasa el costo FINAL a ultimoCosto: ${limonRecibido.ultimoCosto?.toFixed(2)}`,
    );
    await agregarGastosCompra(actor, cf.id, [
      { motivo: "Valija", montoUSDT: 50_000 },
      { motivo: "Envío", montoUSDT: 30_000 },
    ]);
    c = await obtenerCompra(actor, cf.id);
    check(
      c.gastosExtrasTotal === "80000.00" &&
        c.costoFinalTotal === "1180000.00" &&
        c.costoUnitarioFinalPromedio === "11800.00" &&
        c.items[0]?.costoUnitarioFinal === "11800.00",
      `gastos Valija 50.000 + Envío 30.000 → total ${c.costoFinalTotal}, por unidad ${c.costoUnitarioFinalPromedio}`,
    );
    const limonFinal = await db.variante.findUniqueOrThrow({ where: { id: limon.id } });
    check(
      limonFinal.ultimoCosto?.toFixed(2) === "11800.00",
      `compra recibida → ultimoCosto actualizado a ${limonFinal.ultimoCosto?.toFixed(2)}`,
    );
    const historial = await db.costoVarianteHistorial.findMany({
      where: { varianteId: limon.id, compraId: cf.id },
      orderBy: { createdAt: "asc" },
    });
    check(
      historial.length === 2 &&
        historial[0]?.origen === "COMPRA_RECIBIDA" &&
        historial[1]?.origen === "COSTOS_FINALES_COMPRA" &&
        historial[1]?.costoAnterior?.toFixed(2) === "11000.00" &&
        historial[1]?.costoNuevo.toFixed(2) === "11800.00",
      `historial de costos: ${historial.map((h) => `${h.origen} ${h.costoAnterior?.toFixed(0)}→${h.costoNuevo.toFixed(0)}`).join(" · ")}`,
    );

    // Una compra posterior del mismo sabor manda: cambiar la vieja no toca ultimoCosto.
    const cNueva = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: g1.id,
        items: [{ varianteId: limon.id, cantidad: 1, costoUnitarioUSDT: "9000" }],
      }),
    );
    await recibirCompra(actor, cNueva.id, { actualizarPrecioProveedor: false });
    await cambiarComisionPasista(actor, cf.id, 5);
    c = await obtenerCompra(actor, cf.id);
    const limonDespues = await db.variante.findUniqueOrThrow({ where: { id: limon.id } });
    check(
      c.comisionPasistaMonto === "50000.00" &&
        c.costoFinalTotal === "1130000.00" &&
        limonDespues.ultimoCosto?.toFixed(2) === "9000.00",
      `bajar la comisión a 5% de la compra vieja: costo final ${c.costoFinalTotal}, ultimoCosto sigue ${limonDespues.ultimoCosto?.toFixed(2)} (manda la compra nueva)`,
    );
    await cambiarComisionPasista(actor, cf.id, null);
    c = await obtenerCompra(actor, cf.id);
    check(
      c.comisionPasistaPorcentaje === null &&
        c.comisionPasistaMonto === "0.00" &&
        c.costoFinalTotal === "1080000.00",
      `destildar la comisión → ${c.costoFinalTotal}`,
    );

    const gasto = c.gastos.find((g) => g.motivo === "Envío")!;
    await anularGastoCompra(actor, gasto.id, "Se cargó de más");
    c = await obtenerCompra(actor, cf.id);
    check(
      c.gastosExtrasTotal === "50000.00" && c.costoFinalTotal === "1050000.00",
      `anular el gasto de envío → gastos ${c.gastosExtrasTotal}, costo final ${c.costoFinalTotal}`,
    );
    check(
      (await error(() => anularGastoCompra(actor, gasto.id, "otra vez"))) instanceof DomainError,
      "un gasto anulado no se vuelve a anular",
    );
    const mensajeDb = async (fn: () => Promise<unknown>) => {
      const e = await error(fn);
      return e instanceof Error ? e.message : "";
    };
    check(
      /no se borran/.test(
        await mensajeDb(
          () => prisma.$executeRaw`DELETE FROM "GastoCompra" WHERE "id" = ${gasto.id}`,
        ),
      ) &&
        /no se modifican/.test(
          await mensajeDb(
            () => prisma.$executeRaw`UPDATE "GastoCompra" SET "monto" = 1 WHERE "id" = ${gasto.id}`,
          ),
        ),
      "la DB no deja borrar ni editar un gasto (solo anular)",
    );
    check(
      /no se pueden modificar/.test(
        await mensajeDb(
          () =>
            prisma.$executeRaw`UPDATE "CompraItem" SET "cantidad" = 1 WHERE "compraId" = ${cf.id}`,
        ),
      ),
      "los ítems de la compra recibida siguen congelados (salvo el costo final)",
    );
    check(
      /check|violates|coincide/i.test(
        await mensajeDb(
          () =>
            prisma.$executeRaw`UPDATE "Compra" SET "gastosExtrasTotal" = 1, "costoFinalTotal" = "total" + 1 WHERE "id" = ${cf.id}`,
        ),
      ),
      "la DB verifica que los gastos de la compra sean la suma de sus gastos vigentes",
    );
    await anularCompra(actor, cNueva.id, "Prueba de costos finales");
    check(
      (await error(() =>
        agregarGastosCompra(actor, cNueva.id, [{ motivo: "Flete", montoUSDT: 1 }]),
      )) instanceof DomainError,
      "una compra anulada no acepta gastos",
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n11) Pasista: comisión por compra, pago del mes, ajustes y anulación");
  {
    const comisiones = (compraId: string) =>
      db.comisionPasista.findMany({ where: { compraId }, orderBy: { tipo: "asc" } });
    const pendienteAntes = Number((await totalesPasista(actor, mesActualAR())).pendienteMes);
    const cp = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: g1.id,
        comisionPasistaPorcentaje: "10",
        items: [{ varianteId: uva.id, cantidad: 100, costoUnitarioUSDT: "10000" }],
      }),
    );
    let filas = await comisiones(cp.id);
    const mes = mesActualAR();
    check(
      filas.length === 1 &&
        filas[0]?.tipo === "ORIGINAL" &&
        filas[0].estado === "PENDIENTE" &&
        filas[0].monto.toFixed(2) === "100000.00" &&
        filas[0].mes?.toISOString().slice(0, 7) === mes,
      `tick 10% → comisión PENDIENTE de ${filas[0]?.monto.toFixed(0)} en ${filas[0]?.mes?.toISOString().slice(0, 7)}`,
    );
    const lista = await listarPasista(actor, { mes, page: 1, pageSize: 100 });
    const tot = await totalesPasista(actor, mes);
    check(
      lista.filas.some((f) => f.compraId === cp.id && f.unidades === 100) &&
        Number(tot.pendienteMes) - pendienteAntes === 100_000,
      `/pasista del mes la lista y el pendiente del mes sube $100.000 (${pendienteAntes} → ${tot.pendienteMes})`,
    );
    await cambiarComisionPasista(actor, cp.id, 12);
    filas = await comisiones(cp.id);
    check(
      filas.length === 1 && filas[0]?.monto.toFixed(2) === "120000.00",
      "pendiente: cambiar el % actualiza la misma fila",
    );

    const vendedora = await prisma.usuario.findFirstOrThrow({
      where: { rol: RolUsuario.EMPLEADO, deletedAt: null },
    });
    const ctxEmpleado = {
      ...actor,
      usuarioId: vendedora.id,
      usuario: { rol: vendedora.rol, permisos: [], paneles: [VAPES] },
    };
    check(
      (await error(() =>
        marcarPagadas(
          ctxEmpleado,
          { ids: [filas[0]!.id] },
          { medioPago: "EFECTIVO", fecha: new Date() },
        ),
      )) instanceof ForbiddenError,
      "una empleada no puede marcar comisiones pagadas",
    );
    const pago = await marcarPagadas(
      actor,
      { ids: [filas[0]!.id] },
      { medioPago: "TRANSFERENCIA", referencia: "TRF-1", fecha: new Date() },
    );
    filas = await comisiones(cp.id);
    check(
      pago.cantidad === 1 && pago.total === "120000.00" && filas[0]?.estado === "PAGADA",
      `marcar pagada → ${pago.total} PAGADA`,
    );
    const quitar = await error(() => cambiarComisionPasista(actor, cp.id, null));
    check(
      quitar instanceof DomainError && /ya se pagó/.test(quitar.message),
      `destildar una comisión pagada → «${quitar instanceof Error ? quitar.message.slice(0, 60) : ""}…»`,
    );
    await cambiarComisionPasista(actor, cp.id, 10);
    filas = await comisiones(cp.id);
    check(
      filas.length === 2 &&
        filas[0]?.estado === "PAGADA" &&
        filas[0].monto.toFixed(2) === "120000.00" &&
        filas[1]?.tipo === "AJUSTE" &&
        filas[1].monto.toFixed(2) === "-20000.00" &&
        filas[1].estado === "PENDIENTE",
      `bajar a 10% después de pagada → AJUSTE ${filas[1]?.monto.toFixed(0)} pendiente`,
    );
    const mensaje = async (fn: () => Promise<unknown>) => {
      const e = await error(fn);
      return e instanceof Error ? e.message : "";
    };
    check(
      /ya está pagada/.test(
        await mensaje(
          () =>
            prisma.$executeRaw`UPDATE "ComisionPasista" SET "monto" = 1 WHERE "id" = ${filas[0]!.id}`,
        ),
      ) &&
        /ya está pagada/.test(
          await mensaje(
            () => prisma.$executeRaw`DELETE FROM "ComisionPasista" WHERE "id" = ${filas[0]!.id}`,
          ),
        ),
      "la DB no deja modificar ni borrar una comisión pagada",
    );
    await deshacerPago(actor, filas[0]!.id, "Prueba de deshacer");
    filas = await comisiones(cp.id);
    check(
      filas.length === 1 &&
        filas[0]?.estado === "PENDIENTE" &&
        filas[0].monto.toFixed(2) === "100000.00",
      `deshacer el pago junta original + ajuste: ${filas[0]?.monto.toFixed(0)} pendiente`,
    );
    const pagoMes = await marcarPagadas(
      actor,
      { mes },
      { medioPago: "EFECTIVO", fecha: new Date() },
    );
    check(
      pagoMes.cantidad >= 1,
      `marcar el mes como pagado: ${pagoMes.cantidad} comisión(es), ${pagoMes.total}`,
    );
    await anularCompra(actor, cp.id, "Prueba anulación con comisión pagada");
    filas = await comisiones(cp.id);
    check(
      filas.length === 2 &&
        filas[1]?.tipo === "AJUSTE" &&
        filas[1].monto.toFixed(2) === "-100000.00",
      "anular la compra con la comisión pagada → ajuste negativo (a descontar)",
    );

    const cSinPagar = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: g1.id,
        comisionPasistaPorcentaje: "10",
        items: [{ varianteId: uva.id, cantidad: 2, costoUnitarioUSDT: "1000" }],
      }),
    );
    await anularCompra(actor, cSinPagar.id, "Prueba anulación sin pagar");
    check(
      (await comisiones(cSinPagar.id)).length === 0,
      "anular con la comisión pendiente la borra",
    );
    const det = await detallePasista(actor, filas[0]!.id);
    check(
      det.compra.items.length === 1 && det.compra.unidades === 100 && det.relacionadas.length === 1,
      "detalle: la compra con sus productos y el ajuste relacionado",
    );
    const desdeCosmetic = await error(() =>
      detallePasista({ ...actor, panelId: COSMETIC }, filas[0]!.id),
    );
    check(desdeCosmetic instanceof NotFoundError, "una comisión de Vapes no existe desde Cosmetic");
  }

  // ---------------------------------------------------------------------------
  console.log("\n12) Pasista en los tres paneles: config, comisión, detalle y totales por panel");
  for (const panelId of [VAPES, COSMETIC, "pnl_especiales"]) {
    const ctxP = { ...actor, panelId };
    const dbP = dbPara(panelId);
    const cfg = await obtenerConfigCompras(ctxP);
    const fila = await dbP.configuracion.findFirst({ where: { clave: "compras" } });
    check(
      cfg.comisionPasistaPorcentajeDefault > 0 && fila !== null,
      `${panelId}: config "compras" cargada (${cfg.comisionPasistaPorcentajeDefault}% por defecto)`,
    );
    const { varianteId, proveedorId, depositoId } = await transaccion(ctxP, async (tx) => {
      const marca = await tx.marca.upsert({
        where: { panelId_nombre: { panelId, nombre: "Test Pasista" } },
        update: {},
        create: { nombre: "Test Pasista" },
      });
      const p = await tx.producto.create({
        data: {
          marcaId: marca.id,
          nombre: `Pas ${sufijo}`,
          precioVenta: "5000.00",
          variantes: { create: [{ nombre: "Rosa", sku: `TP-${panelId}-${sufijo}` }] },
        },
        include: { variantes: true },
      });
      const prov = await tx.proveedor.create({
        data: { nombre: `Pasista ${sufijo}`, nombreTienda: `Tienda ${panelId}` },
      });
      const dep = await tx.deposito.findFirstOrThrow({ where: { activo: true } });
      return { varianteId: p.variantes[0]!.id, proveedorId: prov.id, depositoId: dep.id };
    });
    const mes = mesActualAR();
    const antes = await totalesPasista(ctxP, mes);
    const compraP = await crearCompra(
      ctxP,
      compraSchema.parse({
        proveedorId,
        depositoId,
        comisionPasistaPorcentaje: "7.5",
        items: [{ varianteId, cantidad: 4, costoUnitarioUSDT: "1000" }],
      }),
    );
    await recibirCompra(ctxP, compraP.id, { actualizarPrecioProveedor: false });
    const deCompra = await comisionesDeCompra(ctxP, compraP.id);
    const tot = await totalesPasista(ctxP, mes);
    check(
      deCompra.length === 1 &&
        deCompra[0]!.monto === "300.00" &&
        Number(tot.devengadoMes) - Number(antes.devengadoMes) === 300 &&
        Number(tot.pendienteMes) - Number(antes.pendienteMes) === 300 &&
        Number(tot.totalComprasMes) - Number(antes.totalComprasMes) === 4000 &&
        tot.comprasMes - antes.comprasMes === 1,
      `${panelId}: compra $ 4.000 × 7,5% → comisión ${deCompra[0]?.monto}; totales del mes suben`,
    );
    const det = await detallePasista(ctxP, deCompra[0]!.id);
    check(
      det.compra.items.length === 1 &&
        det.compra.items[0]!.sabor === "Rosa" &&
        det.compra.total === "4000.00" &&
        det.totales.total === "300.00" &&
        det.totales.pendiente === "300.00" &&
        det.comisionVigente === "300.00" &&
        det.comision.compra.endsWith(String(compraP.numero).padStart(6, "0")),
      `${panelId}: detalle con la compra ${det.comision.compra}, sus productos y el cálculo`,
    );
    const otro = panelId === VAPES ? COSMETIC : VAPES;
    check(
      (await comisionesDeCompra({ panelId: otro }, compraP.id)).length === 0,
      `${panelId}: su comisión no aparece desde ${otro}`,
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n13) Confirmar → pendiente de recibir; Recibido → stock; costo final por modelo");
  {
    const stockDe = async (varianteId: string) =>
      (await db.stock.findFirst({ where: { varianteId, depositoId: g2.id } }))?.cantidad ?? 0;
    const [uvaAntes, duraznoAntes] = [await stockDe(uva.id), await stockDe(durazno.id)];
    const conf = await crearCompra(
      actor,
      compraSchema.parse({
        proveedorId: prov.id,
        depositoId: g2.id,
        comisionPasistaPorcentaje: "10",
        items: [
          { varianteId: uva.id, cantidad: 10, costoUnitarioUSDT: "10000" },
          { varianteId: durazno.id, cantidad: 10, costoUnitarioUSDT: "20000" },
        ],
      }),
    );
    await agregarGastosCompra(actor, conf.id, [{ motivo: "Valija", montoUSDT: 30_000 }]);
    let c = await obtenerCompra(actor, conf.id);
    const finales = () => c.items.map((i) => i.costoUnitarioFinal).join(" / ");
    check(
      c.estado === EstadoCompra.BORRADOR &&
        (await stockDe(uva.id)) === uvaAntes &&
        (await stockDe(durazno.id)) === duraznoAntes &&
        c.movimientos === 0,
      "confirmar crea la compra pendiente de recibir sin tocar el stock",
    );
    check(
      finales() === "12500.00 / 23500.00" && c.costoFinalTotal === "360000.00",
      `pasista proporcional al precio + gastos parejos: finales ${finales()}, total ${c.costoFinalTotal}`,
    );
    const comisionConf = await db.comisionPasista.findMany({ where: { compraId: conf.id } });
    check(
      comisionConf.length === 1 && comisionConf[0]!.monto.toFixed(2) === "30000.00",
      `la comisión del pasista se genera al confirmar (criterio de siempre): ${comisionConf[0]?.monto.toFixed(2)}`,
    );
    await recibirCompra(actor, conf.id, { actualizarPrecioProveedor: false });
    c = await obtenerCompra(actor, conf.id);
    const [vUva, vDurazno] = await Promise.all([
      db.variante.findUniqueOrThrow({ where: { id: uva.id } }),
      db.variante.findUniqueOrThrow({ where: { id: durazno.id } }),
    ]);
    check(
      c.estado === EstadoCompra.RECIBIDA &&
        (await stockDe(uva.id)) === uvaAntes + 10 &&
        (await stockDe(durazno.id)) === duraznoAntes + 10,
      "«Recibido» suma el stock al galpón",
    );
    check(
      vUva.ultimoCosto?.toFixed(2) === "12500.00" &&
        vDurazno.ultimoCosto?.toFixed(2) === "23500.00",
      `ultimoCosto por modelo: ${vUva.ultimoCosto?.toFixed(2)} / ${vDurazno.ultimoCosto?.toFixed(2)}`,
    );
    const suma = c.items.reduce((a, i) => a + Number(i.costoUnitarioFinal) * i.cantidad, 0);
    check(
      suma.toFixed(2) === c.costoFinalTotal,
      `Σ final × cantidad = costo final total (${suma})`,
    );
    await cambiarComisionPasista(actor, conf.id, 5);
    c = await obtenerCompra(actor, conf.id);
    const vUva2 = await db.variante.findUniqueOrThrow({ where: { id: uva.id } });
    check(
      finales() === "12000.00 / 22500.00" && vUva2.ultimoCosto?.toFixed(2) === "12000.00",
      `bajar a 5% recalcula por modelo: ${finales()}, ultimoCosto Uva ${vUva2.ultimoCosto?.toFixed(2)}`,
    );
    check(
      (await error(() =>
        recibirCompra(actor, conf.id, { actualizarPrecioProveedor: false }),
      )) instanceof DomainError,
      "«Recibido» dos veces no duplica el stock",
    );
  }

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
