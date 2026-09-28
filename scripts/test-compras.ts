/**
 * Compras a nivel servicios + DB en el panel Vapes: proveedores (teléfono,
 * nombre de tienda, precios por producto), compras por sabor (proveedor y
 * galpón obligatorios, costo sugerido, recibir con último costo y precio del
 * proveedor, anular con devolución), recuento "Contar" (50 → 48), códigos
 * internos, PDF de etiquetas y aislamiento entre paneles.
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
import { ConflictError, DomainError, NotFoundError } from "../src/server/errors";
import {
  actualizarCompra,
  anularCompra,
  costoSugerido,
  crearCompra,
  obtenerCompra,
  preciosQueCambian,
  recibirCompra,
} from "../src/server/services/compra.service";
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

async function main() {
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
      productos: [{ productoId: producto.id, precio: "5100" }],
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
      productos: [{ productoId: producto.id, precio: "4900" }],
    }),
  );
  const enDolares = await crearProveedor(
    actor,
    crearProveedorSchema.parse({ nombre: `Leo ${sufijo}`, nombreTienda: `Dólar ${sufijo}` }),
  );
  await asignarProducto(actor, enDolares.id, {
    productoId: producto.id,
    precio: 4,
    moneda: Moneda.USD,
  });
  const comparador = await proveedoresDeProducto(actor, producto.id);
  const enPesos = comparador.filter((c) => c.moneda === Moneda.ARS);
  check(
    comparador.length === 3 &&
      comparador.some((c) => c.proveedorId === enDolares.id && c.moneda === Moneda.USD) &&
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
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
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
    items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
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
      { varianteId: uva.id, cantidad: 10, costoUnitario: "5200" },
      { varianteId: limon.id, cantidad: 5, costoUnitario: "4800.50" },
      { varianteId: durazno.id, cantidad: 3, costoUnitario: "5000" },
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
        { varianteId: uva.id, cantidad: 5, costoUnitario: 5300 },
        { varianteId: limon.id, cantidad: 2, costoUnitario: 4800.5 },
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
      items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
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
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
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
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
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

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
