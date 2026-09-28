/**
 * Compras a nivel servicios + DB en el panel Vapes: compras (recibir con
 * actualización de costos, anular con devolución), proveedores, recuento
 * "Contar" (50 → 48), códigos internos, PDF de etiquetas y aislamiento
 * entre paneles.
 * Uso: pnpm test:compras — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoCompra, RolUsuario, TipoMovimiento } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import { digitoLuhn, generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { dbPara, type Ctx } from "../src/server/db/panel-scoped";
import { compraSchema } from "../src/lib/validations/compra";
import { productoSchema } from "../src/lib/validations/producto";
import { crearProveedorSchema } from "../src/lib/validations/proveedor";
import { ConflictError, DomainError, NotFoundError } from "../src/server/errors";
import {
  actualizarCompra,
  anularCompra,
  crearCompra,
  obtenerCompra,
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
  crearProducto,
  esCodigoInterno,
  generarCodigoInterno,
  prefijoCodigoInterno,
} from "../src/server/services/producto.service";
import {
  crearProveedor,
  darDeBajaProveedor,
  listarProveedores,
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

const CON_COSTO = { incluirCostoActual: true };

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const actor: Ctx & { usuario: { rol: RolUsuario } } = {
    panelId: VAPES,
    usuarioId: owner.id,
    meta: { ip: "127.0.0.1", userAgent: "test-compras" },
    usuario: { rol: owner.rol },
  };
  const [g1, g2] = await db.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");
  const vapes = await db.categoria.findFirstOrThrow({ where: { nombre: "Vapes" } });
  const sufijo = String(Date.now()).slice(-6);

  const producto = await crearProducto(
    actor,
    productoSchema.parse({
      nombre: `Vape Compras ${sufijo}`,
      categoriaId: vapes.id,
      tieneVariantes: true,
      variantes: ["Uva", "Limón", "Durazno"].map((nombre, i) => ({
        nombre,
        codigoBarras: generarEan13(`7797${sufijo}${String(i).padStart(2, "0")}`),
        precioCosto: "5000",
        precioVenta: "9000",
      })),
    }),
  );
  const porNombre = (n: string) => producto.variantes.find((v) => v.nombre === n);
  const [uva, limon, durazno] = [porNombre("Uva"), porNombre("Limón"), porNombre("Durazno")];
  if (!uva || !limon || !durazno) throw new Error("Faltan variantes");

  // ---------------------------------------------------------------------------
  console.log("\n1) Proveedores: CUIT con dígito verificador, único, baja lógica");
  check(
    !crearProveedorSchema.safeParse({ nombre: "X", cuit: "30-71234567-2" }).success,
    "CUIT con verificador incorrecto → rechazado por Zod",
  );
  const cuit = "20" + sufijo.padStart(8, "0").slice(0, 8);
  const cuitValido =
    cuit +
    String(
      (() => {
        const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        const r = 11 - (pesos.reduce((a, p, i) => a + p * Number(cuit[i]), 0) % 11);
        return r === 11 ? 0 : r === 10 ? 9 : r;
      })(),
    );
  const prov = await crearProveedor(
    actor,
    crearProveedorSchema.parse({
      nombre: `Importadora ${sufijo}`,
      cuit: cuitValido.replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
    }),
  );
  const guardado = await prisma.proveedor.findUniqueOrThrow({ where: { id: prov.id } });
  check(guardado.cuit === cuitValido, `CUIT guardado normalizado: ${guardado.cuit}`);
  const dup = await error(() =>
    crearProveedor(actor, crearProveedorSchema.parse({ nombre: "Otro", cuit: cuitValido })),
  );
  check(
    dup instanceof ConflictError && Boolean(dup.fields?.cuit),
    `CUIT repetido → ConflictError en el campo cuit`,
  );
  const provTemp = await crearProveedor(
    actor,
    crearProveedorSchema.parse({ nombre: `Temporal ${sufijo}` }),
  );
  await darDeBajaProveedor(actor, provTemp.id);
  check(
    !(await listarProveedores(actor, { conCompras: false })).some((p) => p.id === provTemp.id),
    "proveedor dado de baja → no aparece en el listado",
  );

  // ---------------------------------------------------------------------------
  console.log("\n2) Compra de 3 ítems: totales calculados en el servidor");
  const datos = compraSchema.parse({
    proveedorId: prov.id,
    depositoId: g1.id,
    descuento: "1000",
    notas: "Remito 0001-000123",
    items: [
      { varianteId: uva.id, cantidad: 10, costoUnitario: "5200" },
      { varianteId: limon.id, cantidad: 5, costoUnitario: "4800.50" },
      { varianteId: durazno.id, cantidad: 3, costoUnitario: "5000" },
    ],
  });
  const excedido = await error(() =>
    crearCompra(actor, { ...datos, descuento: 999_999 } as typeof datos),
  );
  check(
    excedido instanceof DomainError && Boolean(excedido.fields?.descuento),
    "descuento mayor al subtotal → DomainError en el campo descuento",
  );
  const compra = await crearCompra(actor, datos);
  let det = await obtenerCompra(actor, compra.id, CON_COSTO);
  // 10×5200 + 5×4800,50 + 3×5000 = 52000 + 24002,50 + 15000 = 91002,50 − 1000
  check(det.estado === EstadoCompra.BORRADOR, `compra #${det.numero} creada en BORRADOR`);
  check(
    det.subtotal === "91002.50" && det.total === "90002.50",
    `subtotal ${det.subtotal}, total ${det.total} (calculados por el servidor)`,
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
  det = await obtenerCompra(actor, compra.id, CON_COSTO);
  check(
    det.items.find((i) => i.varianteId === durazno.id)?.cantidad === 4 && det.total === "95002.50",
    `borrador editado: Durazno ×4, total ${det.total}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Recibir con «actualizar costos»");
  const stocksAntes = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  const r = await recibirCompra(actor, compra.id, { actualizarCostos: true });
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
    movs.every((m) => m.depositoId === g1.id && m.motivo === `Compra #${det.numero}`),
    "en el depósito de la compra, motivo «Compra #N»",
  );
  const stocksDespues = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  check(
    stocksDespues.join() ===
      [stocksAntes[0]! + 10, stocksAntes[1]! + 5, stocksAntes[2]! + 4].join(),
    `stock ${stocksAntes.join("/")} → ${stocksDespues.join("/")}`,
  );
  // Durazno no cambia de costo (5000 = 5000): solo se actualizan Uva y Limón.
  check(r.costosActualizados === 2, `costos actualizados: ${r.costosActualizados} (Uva y Limón)`);
  const variantes = await prisma.variante.findMany({
    where: { id: { in: [uva.id, limon.id, durazno.id] } },
  });
  const costo = (id: string) => variantes.find((v) => v.id === id)!.precioCosto.toFixed(2);
  check(
    costo(uva.id) === "5200.00" && costo(limon.id) === "4800.50" && costo(durazno.id) === "5000.00",
    `precioCosto actualizado: Uva ${costo(uva.id)}, Limón ${costo(limon.id)}, Durazno ${costo(durazno.id)}`,
  );
  const otraVez = await error(() => recibirCompra(actor, compra.id, { actualizarCostos: false }));
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
  det = await obtenerCompra(actor, compra.id, CON_COSTO);
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
      depositoId: g2.id,
      items: [
        { varianteId: uva.id, cantidad: 5, costoUnitario: 5200 },
        { varianteId: limon.id, cantidad: 2, costoUnitario: 4800.5 },
      ],
    }),
  );
  await recibirCompra(actor, c2.id, { actualizarCostos: false });
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
    (await obtenerCompra(actor, c2.id, CON_COSTO)).estado === EstadoCompra.RECIBIDA &&
      (await stockDe(limon.id, g2.id)) === 2,
    "la compra sigue RECIBIDA y el Limón no se devolvió",
  );
  const c3 = await crearCompra(
    actor,
    compraSchema.parse({
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
  const sinCodigo = await crearProducto(
    actor,
    productoSchema.parse({
      nombre: `Cargador USB-C ${sufijo}`,
      categoriaId: vapes.id,
      tieneVariantes: false,
      variantes: [{ nombre: "Único", precioCosto: 1000, precioVenta: 2500 }],
    }),
  );
  const cargador = sinCodigo.variantes[0]!;
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
  const sinPermiso = await crearProducto(
    actor,
    productoSchema.parse({
      nombre: `Funda ${sufijo}`,
      categoriaId: vapes.id,
      tieneVariantes: false,
      variantes: [{ nombre: "Único", precioCosto: 100, precioVenta: 300 }],
    }),
  );
  const e7 = await error(() =>
    generarPdfEtiquetas(
      actor,
      {
        formato: "rollo50x30",
        mostrarPrecio: false,
        items: [{ varianteId: sinPermiso.variantes[0]!.id, cantidad: 1 }],
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
  const eLeer = await error(() => obtenerCompra(ctxCosmetic, compra.id, CON_COSTO));
  check(eLeer instanceof NotFoundError, "leer una compra de Vapes desde Cosmetic → no existe");
  const eAnular = await error(() => anularCompra(ctxCosmetic, c2.id, "intruso"));
  check(eAnular instanceof NotFoundError, "anular una compra de Vapes desde Cosmetic → no existe");
  const eCruzada = await error(() =>
    crearCompra(
      ctxCosmetic,
      compraSchema.parse({
        depositoId: depCosmetic.id,
        items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
      }),
    ),
  );
  check(
    eCruzada instanceof NotFoundError,
    `comprar en Cosmetic una variante de Vapes → «${(eCruzada as Error)?.message}»`,
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
  check(
    !(await listarProveedores(ctxCosmetic, { conCompras: false })).some((p) => p.id === prov.id),
    "los proveedores de Vapes no aparecen en Cosmetic",
  );
  const provCosmetic = await crearProveedor(
    ctxCosmetic,
    crearProveedorSchema.parse({ nombre: `Importadora ${sufijo}`, cuit: cuitValido }),
  );
  check(provCosmetic.id !== prov.id, "el mismo CUIT puede existir como proveedor de otro panel");

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
