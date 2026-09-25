/**
 * Verificación del Prompt 4 a nivel servicios + DB: compras (recibir con
 * actualización de costos, anular con devolución), proveedores, recuento
 * "Contar" (50 → 48), códigos internos y PDF de etiquetas.
 * Uso: pnpm test:compras — pensado para una DB recién sembrada (crea datos).
 */
import { EstadoCompra, RolUsuario, TipoMovimiento } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import { digitoLuhn, generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { compraSchema } from "../src/lib/validations/compra";
import { productoSchema } from "../src/lib/validations/producto";
import { crearProveedorSchema } from "../src/lib/validations/proveedor";
import { ConflictError, DomainError } from "../src/server/errors";
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
const stockDe = async (varianteId: string, depositoId: string) =>
  (await prisma.stock.findUnique({ where: { varianteId_depositoId: { varianteId, depositoId } } }))
    ?.cantidad ?? 0;

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, email: "dueno1@negocio.com" },
  });
  const actor = { id: owner.id, meta: { ip: "127.0.0.1", userAgent: "test-compras" } };
  const [g1, g2] = await prisma.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (!g1 || !g2) throw new Error("Faltan depósitos");
  const vapes = await prisma.categoria.findFirstOrThrow({ where: { nombre: "Vapes" } });
  const sufijo = String(Date.now()).slice(-6);

  const producto = await crearProducto(
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
    actor,
  );
  const [uva, limon, durazno] = producto.variantes;
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
    crearProveedorSchema.parse({
      nombre: `Importadora ${sufijo}`,
      cuit: cuitValido.replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
    }),
    actor,
  );
  const guardado = await prisma.proveedor.findUniqueOrThrow({ where: { id: prov.id } });
  check(guardado.cuit === cuitValido, `CUIT guardado normalizado: ${guardado.cuit}`);
  const dup = await error(() =>
    crearProveedor(crearProveedorSchema.parse({ nombre: "Otro", cuit: cuitValido }), actor),
  );
  check(
    dup instanceof ConflictError && Boolean(dup.fields?.cuit),
    `CUIT repetido → ConflictError en el campo cuit`,
  );
  const provTemp = await crearProveedor(
    crearProveedorSchema.parse({ nombre: `Temporal ${sufijo}` }),
    actor,
  );
  await darDeBajaProveedor(provTemp.id, actor);
  check(
    !(await listarProveedores()).some((p) => p.id === provTemp.id),
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
    crearCompra({ ...datos, descuento: 999_999 } as typeof datos, actor),
  );
  check(
    excedido instanceof DomainError && Boolean(excedido.fields?.descuento),
    "descuento mayor al subtotal → DomainError en el campo descuento",
  );
  const compra = await crearCompra(datos, actor);
  let det = await obtenerCompra(compra.id);
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
  await actualizarCompra(
    compra.id,
    {
      ...datos,
      items: datos.items.map((i) => (i.varianteId === durazno.id ? { ...i, cantidad: 4 } : i)),
    },
    actor,
  );
  det = await obtenerCompra(compra.id);
  check(
    det.items.find((i) => i.varianteId === durazno.id)?.cantidad === 4 && det.total === "95002.50",
    `borrador editado: Durazno ×4, total ${det.total}`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n3) Recibir con «actualizar costos»");
  const stocksAntes = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  const historialAntes = await prisma.historialPrecio.count({
    where: { varianteId: { in: [uva.id, limon.id, durazno.id] } },
  });
  const r = await recibirCompra(compra.id, actor, { actualizarCostos: true });
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
  const hist = await prisma.historialPrecio.findMany({
    where: { varianteId: { in: [uva.id, limon.id, durazno.id] } },
    orderBy: { createdAt: "asc" },
  });
  // Durazno no cambia de costo (5000 = 5000): no genera historial.
  check(
    hist.length - historialAntes === 2,
    `HistorialPrecio: ${hist.length - historialAntes} filas nuevas (Uva y Limón; Durazno ya costaba 5000)`,
  );
  const variantes = await prisma.variante.findMany({
    where: { id: { in: [uva.id, limon.id, durazno.id] } },
  });
  const costo = (id: string) => variantes.find((v) => v.id === id)!.precioCosto.toFixed(2);
  check(
    costo(uva.id) === "5200.00" && costo(limon.id) === "4800.50" && costo(durazno.id) === "5000.00",
    `precioCosto actualizado: Uva ${costo(uva.id)}, Limón ${costo(limon.id)}, Durazno ${costo(durazno.id)}`,
  );
  check(
    hist.slice(historialAntes).every((h) => h.motivo === `Compra #${det.numero}`),
    "historial con motivo «Compra #N»",
  );
  const otraVez = await error(() => recibirCompra(compra.id, actor, { actualizarCostos: false }));
  check(
    otraVez instanceof DomainError && /ya fue recibida/.test(otraVez.message),
    `recibir de nuevo → DomainError: ${(otraVez as Error)?.message}`,
  );
  const congelada = await error(() => actualizarCompra(compra.id, datos, actor));
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
  const an = await anularCompra(compra.id, "Mercadería con falla", actor);
  const devs = await prisma.movimientoStock.findMany({
    where: { referenciaId: compra.id, tipo: TipoMovimiento.DEVOLUCION_PROVEEDOR },
  });
  check(an.devoluciones === 3 && devs.length === 3, `3 movimientos DEVOLUCION_PROVEEDOR`);
  const stocksFinal = await Promise.all([uva, limon, durazno].map((v) => stockDe(v.id, g1.id)));
  check(stocksFinal.join() === stocksAntes.join(), `stock vuelve a ${stocksFinal.join("/")}`);
  det = await obtenerCompra(compra.id);
  check(
    det.estado === EstadoCompra.ANULADA && /\[Anulada\] Mercadería con falla/.test(det.notas ?? ""),
    "estado ANULADA y motivo en las notas",
  );
  check(
    (await error(() => anularCompra(compra.id, "otra vez", actor))) instanceof DomainError,
    "anular de nuevo → DomainError",
  );
  const audit = await prisma.auditLog.count({ where: { entidad: "Compra", entidadId: compra.id } });
  check(audit === 4, `AuditLog de la compra: ${audit} (crear, editar, recibir, anular)`);

  // ---------------------------------------------------------------------------
  console.log("\n5) Anular sin stock suficiente → falla completa, nada se mueve");
  const c2 = await crearCompra(
    compraSchema.parse({
      depositoId: g2.id,
      items: [
        { varianteId: uva.id, cantidad: 5, costoUnitario: 5200 },
        { varianteId: limon.id, cantidad: 2, costoUnitario: 4800.5 },
      ],
    }),
    actor,
  );
  await recibirCompra(c2.id, actor, { actualizarCostos: false });
  await registrarAjuste(
    { depositoId: g2.id, varianteId: uva.id, cantidadReal: 1, motivo: "Se vendieron (test)" },
    actor,
  );
  const e2 = await error(() => anularCompra(c2.id, "Error de carga", actor));
  check(
    e2 instanceof DomainError && /Uva: hay 1, se devuelven 5/.test((e2 as Error).message),
    `DomainError con el detalle: ${(e2 as Error)?.message}`,
  );
  check(
    (await obtenerCompra(c2.id)).estado === EstadoCompra.RECIBIDA &&
      (await stockDe(limon.id, g2.id)) === 2,
    "la compra sigue RECIBIDA y el Limón no se devolvió",
  );
  const c3 = await crearCompra(
    compraSchema.parse({
      depositoId: g1.id,
      items: [{ varianteId: uva.id, cantidad: 1, costoUnitario: 1 }],
    }),
    actor,
  );
  const an3 = await anularCompra(c3.id, "Borrador duplicado", actor);
  check(an3.devoluciones === 0, "anular un borrador no mueve stock");

  // ---------------------------------------------------------------------------
  console.log("\n6) Modo Contar: sistema 50, escaneados 48 → AJUSTE_NEGATIVO de 2");
  const actual = await stockDe(durazno.id, g2.id);
  if (actual < 50)
    await registrarIngresoManual(
      {
        depositoId: g2.id,
        motivo: "Preparar recuento (test)",
        actualizarCosto: false,
        items: [{ varianteId: durazno.id, cantidad: 50 - actual }],
      },
      actor,
    );
  check((await stockDe(durazno.id, g2.id)) === 50, "Durazno en Galpón 2: 50 en sistema");
  const recuento = await registrarAjusteMasivo(
    {
      depositoId: g2.id,
      motivo: "Recuento con escáner",
      items: [{ varianteId: durazno.id, cantidadReal: 48 }],
    },
    actor,
  );
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
  const prefijo = await prefijoCodigoInterno();
  const muestra = await generarCodigoInterno();
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
    productoSchema.parse({
      nombre: `Cargador USB-C ${sufijo}`,
      categoriaId: vapes.id,
      tieneVariantes: false,
      variantes: [{ nombre: "Único", precioCosto: 1000, precioVenta: 2500 }],
    }),
    actor,
  );
  const cargador = sinCodigo.variantes[0]!;
  check(
    (await listarVariantesParaEtiquetas({ soloSinCodigoDeFabrica: true })).some(
      (v) => v.varianteId === cargador.id,
    ),
    "«sin código de fábrica» incluye al cargador",
  );
  const pdf = await generarPdfEtiquetas(
    { formato: "avery65", mostrarPrecio: true, items: [{ varianteId: cargador.id, cantidad: 6 }] },
    actor,
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
  const encontrado = await buscarPorCodigo(asignado!);
  check(
    encontrado?.varianteId === cargador.id,
    "el código interno se resuelve con buscarPorCodigo",
  );
  check(
    (await asignarCodigosInternos([cargador.id], actor)).asignados.length === 0,
    "asignar de nuevo no pisa el código existente",
  );
  const sinPermiso = await crearProducto(
    productoSchema.parse({
      nombre: `Funda ${sufijo}`,
      categoriaId: vapes.id,
      tieneVariantes: false,
      variantes: [{ nombre: "Único", precioCosto: 100, precioVenta: 300 }],
    }),
    actor,
  );
  const e7 = await error(() =>
    generarPdfEtiquetas(
      {
        formato: "rollo50x30",
        mostrarPrecio: false,
        items: [{ varianteId: sinPermiso.variantes[0]!.id, cantidad: 1 }],
      },
      actor,
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
          { formato, mostrarPrecio: true, items: [{ varianteId: uva.id, cantidad: 30 }] },
          actor,
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

  console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} verificación(es) fallaron`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
