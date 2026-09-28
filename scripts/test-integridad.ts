/**
 * Pruebas de integridad de la DB (constraints, triggers, vistas, aislamiento
 * entre paneles) + schemas Zod.
 * Uso: pnpm test:integridad   (requiere migraciones + seed)
 *
 * Casi todo corre en transacciones que terminan en rollback: no deja rastro.
 * Excepción: la prueba de numeración concurrente consume 10 números de la
 * secuencia DEVOLUCION del panel Especiales (`pnpm db:reset` la limpia).
 */
import {
  EstadoTransferencia,
  EstadoVenta,
  MedioPago,
  RolUsuario,
  TipoMovimiento,
} from "@prisma/client";

import { prisma, type Tx } from "../src/lib/db";
import { costoParaVenta, precioVentaEfectivo } from "../src/lib/precios";
import * as v from "../src/lib/validations";
import { dbPara, PanelAislamientoError, transaccion } from "../src/server/db/panel-scoped";
import { siguienteNumero } from "../src/server/db/secuencia";
import { registrarMovimiento } from "../src/server/services/stock.service";

const VAPES = "pnl_vapes";
const COSMETIC = "pnl_cosmetic";
const ESPECIALES = "pnl_especiales";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

class Rollback extends Error {}

const ctxVapes = { panelId: VAPES };

/** Corre `fn` en una tx del panel Vapes y la descarta. Devuelve el resultado de `fn`. */
async function enRollback<T>(fn: (tx: Tx) => Promise<T>, panelId = VAPES): Promise<T> {
  let resultado: T | undefined;
  try {
    await transaccion({ panelId }, async (tx) => {
      resultado = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return resultado as T;
}

/** Igual que enRollback pero con el cliente crudo (para escribir en varios paneles a la vez). */
async function enRollbackCrudo<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let resultado: T | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      resultado = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return resultado as T;
}

function mensaje(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Los errores de Postgres llegan envueltos por Prisma en distintos formatos.
  const conector = /message: "((?:[^"\\]|\\.)*)"/.exec(msg)?.[1]?.replace(/\\"/g, '"');
  const pg = /ERROR: ([^`\n]+)/.exec(msg)?.[1];
  return conector ?? pg ?? msg.split("\n").filter(Boolean).pop() ?? msg;
}

/** Espera que `fn` falle (incluido el COMMIT) y que el mensaje contenga `esperado`. */
async function rechaza(desc: string, fn: () => Promise<unknown>, esperado: string | RegExp) {
  try {
    await fn();
    check(false, `${desc}: NO fue rechazado`);
  } catch (e) {
    if (e instanceof Rollback) return check(false, `${desc}: NO fue rechazado`);
    const m = mensaje(e);
    const coincide = typeof esperado === "string" ? m.includes(esperado) : esperado.test(m);
    check(coincide, `${desc} → "${m}"`);
  }
}

/** Espera que `fn` funcione (en rollback). */
async function permite(desc: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(true, desc);
  } catch (e) {
    check(false, `${desc} → "${mensaje(e)}"`);
  }
}

async function main() {
  const db = dbPara(VAPES);
  const owner = await prisma.usuario.findFirstOrThrow({ where: { rol: RolUsuario.OWNER } });
  const g1 = await db.deposito.findUniqueOrThrow({
    where: { panelId_nombre: { panelId: VAPES, nombre: "Ayres Plaza" } },
  });
  const g2 = await db.deposito.findUniqueOrThrow({
    where: { panelId_nombre: { panelId: VAPES, nombre: "Mercedes" } },
  });
  // Un producto del seed con al menos dos sabores con código de barras.
  const conSabores = await db.producto.findMany({
    where: { deletedAt: null },
    orderBy: { nombreCompleto: "asc" },
    include: {
      variantes: {
        where: { deletedAt: null, codigoBarras: { not: null } },
        orderBy: { nombre: "asc" },
      },
    },
  });
  const [va0, vb0] = conSabores.find((p) => p.variantes.length >= 2)?.variantes ?? [];
  if (!va0 || !vb0) throw new Error("Faltan variantes de seed");
  const [va, vb] = [va0, vb0];
  const categoria = await db.categoria.findFirstOrThrow();
  const marca = await db.marca.findFirstOrThrow({ where: { nombre: { not: "Sin marca" } } });
  const altMango = await db.codigoBarrasAlternativo.findFirstOrThrow();
  const depCosmetic = await dbPara(COSMETIC).deposito.findFirstOrThrow({
    where: { esPrincipal: true },
  });

  /** Crea una venta CONFIRMADA consistente y "olvida" que se creó en esta tx. */
  async function ventaConfirmada(tx: Tx) {
    const numero = await siguienteNumero(tx, VAPES, "VENTA");
    const venta = await tx.venta.create({
      data: {
        numero,
        depositoId: g1.id,
        usuarioId: owner.id,
        estado: EstadoVenta.CONFIRMADA,
        medioPago: MedioPago.EFECTIVO,
        subtotal: "32000.00",
        descuento: "0",
        total: "32000.00",
        costoTotal: "19000.00",
        gananciaBruta: "13000.00",
        items: {
          create: [
            {
              varianteId: va!.id,
              cantidad: 2,
              precioUnitario: "16000.00",
              costoUnitario: "9500.00",
              subtotal: "32000.00",
            },
          ],
        },
      },
      include: { items: true },
    });
    // Simula que la venta viene de una transacción anterior.
    await tx.$executeRaw`SELECT set_config(fn_doc_guc_key('Venta', ${venta.id}), '', true)`;
    return venta;
  }

  console.log("\nA) CHECKs e índices parciales");
  // Postgres devuelve unique_violation (23505) tanto de los índices como del
  // trigger de unicidad cruzada; Prisma lo expone como P2002 "Unique constraint failed".
  await rechaza(
    "precioVenta negativo (alta de variante)",
    () =>
      db.variante.create({
        data: {
          productoId: va.productoId,
          nombre: "Negativa",
          sku: "TST-NEG",
          ultimoCosto: 1,
          precioVenta: "-1",
        },
      }),
    "Variante_precioVenta_chk",
  );
  await rechaza(
    "precioVenta negativo (modificación)",
    () => db.variante.update({ where: { id: va.id }, data: { precioVenta: "-1" } }),
    "Variante_precioVenta_chk",
  );
  await rechaza(
    "ultimoCosto negativo",
    () => db.variante.update({ where: { id: va.id }, data: { ultimoCosto: "-1" } }),
    "Variante_ultimoCosto_chk",
  );
  await rechaza(
    "precioVenta negativo del producto",
    () => db.producto.update({ where: { id: va.productoId }, data: { precioVenta: "-1" } }),
    "Producto_precioVenta_chk",
  );
  const precioCambiado = await enRollback((tx) =>
    tx.variante.update({ where: { id: va.id }, data: { precioVenta: "17000.00" } }),
  );
  check(
    precioCambiado?.precioVenta?.toString() === "17000",
    "cambiar el precio no requiere historial (UPDATE directo OK)",
  );
  await rechaza(
    "segundo depósito principal en el panel",
    () => db.deposito.update({ where: { id: g2.id }, data: { esPrincipal: true } }),
    "Unique constraint failed",
  );
  await rechaza(
    "email con mayúsculas",
    () =>
      prisma.$executeRaw`UPDATE "Usuario" SET "email" = 'X@NEGOCIO.COM' WHERE "id" = ${owner.id}`,
    "Usuario_email_lowercase_chk",
  );
  await rechaza(
    "código de barras con espacios",
    () => db.variante.update({ where: { id: va.id }, data: { codigoBarras: "779 000" } }),
    "Variante_codigoBarras_chk",
  );
  await rechaza(
    "alternativo = código principal de otra variante",
    () =>
      db.codigoBarrasAlternativo.create({ data: { varianteId: va.id, codigo: vb.codigoBarras! } }),
    "Unique constraint failed",
  );
  await rechaza(
    "principal = código alternativo existente",
    () => db.variante.update({ where: { id: vb.id }, data: { codigoBarras: altMango.codigo } }),
    "Unique constraint failed",
  );
  await rechaza(
    "código de barras duplicado entre variantes del panel",
    () => db.variante.update({ where: { id: vb.id }, data: { codigoBarras: va.codigoBarras } }),
    "Unique constraint failed",
  );
  const reuso = await enRollback(async (tx) => {
    await tx.variante.update({
      where: { id: va.id },
      data: { deletedAt: new Date(), codigoBarras: va.codigoBarras },
    });
    await tx.producto.update({ where: { id: va.productoId }, data: { deletedAt: new Date() } });
    const p = await tx.producto.create({
      data: {
        nombre: "Reuso de código",
        marcaId: marca.id,
        categoriaId: categoria.id,
        precioVenta: 2,
        variantes: {
          create: [
            { nombre: "Único", sku: "TST-REUSO", codigoBarras: va.codigoBarras, ultimoCosto: 1 },
          ],
        },
      },
    });
    return p.id;
  });
  check(reuso !== undefined, "un código de una variante dada de baja se puede reutilizar");
  await permite("el mismo EAN y el mismo SKU en otro panel (Cosmetic)", () =>
    enRollback(async (tx) => {
      const cat = await tx.categoria.create({ data: { nombre: "Test EAN" } });
      const m = await tx.marca.create({ data: { nombre: "Test EAN" } });
      await tx.producto.create({
        data: {
          nombre: "Mismo código",
          marcaId: m.id,
          categoriaId: cat.id,
          precioVenta: 2,
          variantes: {
            create: [
              { nombre: "Único", sku: va.sku, codigoBarras: va.codigoBarras, ultimoCosto: 1 },
            ],
          },
        },
      });
      await tx.codigoBarrasAlternativo.create({
        data: { varianteId: (await tx.variante.findFirstOrThrow()).id, codigo: altMango.codigo },
      });
    }, COSMETIC),
  );

  console.log("B) Stock y ledger");
  await rechaza(
    "INSERT en Stock con cantidad > 0",
    () =>
      prisma.$executeRaw`INSERT INTO "Stock" ("id","panelId","varianteId","depositoId","cantidad","updatedAt") VALUES ('x', ${VAPES}, ${va.id}, ${g1.id}, 5, now())`,
    "se crean con cantidad 0",
  );
  await rechaza(
    "DELETE en Stock",
    () => db.stock.deleteMany({ where: { varianteId: va.id } }),
    'No se pueden borrar filas de "Stock"',
  );
  await rechaza(
    "movimiento sin aplicar a Stock (falla al COMMIT)",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const s = await tx.stock.findUniqueOrThrow({
          where: {
            panelId_varianteId_depositoId: { panelId: VAPES, varianteId: va.id, depositoId: g1.id },
          },
        });
        await tx.movimientoStock.create({
          data: {
            tipo: TipoMovimiento.AJUSTE_POSITIVO,
            varianteId: va.id,
            depositoId: g1.id,
            cantidad: 1,
            stockAnterior: s.cantidad,
            stockPosterior: s.cantidad + 1,
            usuarioId: owner.id,
            motivo: "test",
          },
        });
      }),
    'no se aplicó a "Stock"',
  );
  await rechaza(
    "segundo movimiento con el anterior pendiente",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const s = await tx.stock.findUniqueOrThrow({
          where: {
            panelId_varianteId_depositoId: { panelId: VAPES, varianteId: va.id, depositoId: g1.id },
          },
        });
        const base = {
          tipo: TipoMovimiento.AJUSTE_POSITIVO,
          varianteId: va.id,
          depositoId: g1.id,
          cantidad: 1,
          usuarioId: owner.id,
          motivo: "test",
        };
        await tx.movimientoStock.create({
          data: { ...base, stockAnterior: s.cantidad, stockPosterior: s.cantidad + 1 },
        });
        await tx.movimientoStock.create({
          data: { ...base, stockAnterior: s.cantidad, stockPosterior: s.cantidad + 1 },
        });
      }),
    "sin aplicar",
  );
  await rechaza(
    "INGRESO_COMPRA sin costo",
    () =>
      transaccion(ctxVapes, (tx) =>
        registrarMovimiento(tx, {
          tipo: TipoMovimiento.INGRESO_COMPRA,
          varianteId: va.id,
          depositoId: g1.id,
          cantidad: 1,
          usuarioId: owner.id,
        }),
      ),
    "MovimientoStock_costo_compra_chk",
  );
  await rechaza(
    "registrarMovimiento fuera de una transacción",
    () =>
      registrarMovimiento(db, {
        tipo: TipoMovimiento.INGRESO_MANUAL,
        varianteId: va.id,
        depositoId: g1.id,
        cantidad: 1,
        usuarioId: owner.id,
      }),
    "solo puede usarse dentro de una transacción",
  );

  console.log("C) Sin DELETE físico");
  await rechaza(
    "DELETE Producto",
    () => db.producto.delete({ where: { id: va.productoId } }),
    "usá soft delete",
  );
  await rechaza(
    "DELETE Usuario",
    () => prisma.usuario.delete({ where: { id: owner.id } }),
    "usá soft delete",
  );
  await rechaza(
    "DELETE Depósito",
    () => db.deposito.delete({ where: { id: g2.id } }),
    "desactivalo",
  );
  await rechaza(
    "DELETE Panel",
    () => prisma.panel.delete({ where: { id: ESPECIALES } }),
    "desactivalo",
  );

  console.log("D) Producto ↔ sabores (verificado al COMMIT)");
  await rechaza(
    "producto sin sabores",
    () =>
      transaccion(ctxVapes, (tx) =>
        tx.producto.create({
          data: { nombre: "Huérfano", marcaId: marca.id, precioVenta: 1 },
        }),
      ),
    "debe tener al menos un sabor",
  );
  await rechaza(
    "dos sabores con el mismo nombre en un producto",
    () =>
      transaccion(ctxVapes, (tx) =>
        tx.producto.create({
          data: {
            nombre: "Repetido",
            marcaId: marca.id,
            precioVenta: 2,
            variantes: {
              create: [
                { nombre: "Mango", sku: "TST-A" },
                { nombre: "Mango", sku: "TST-B" },
              ],
            },
          },
        }),
      ),
    "Unique constraint failed",
  );
  await rechaza(
    "dar de baja el único sabor de un producto vivo",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const p = await tx.producto.create({
          data: {
            nombre: "Un sabor",
            marcaId: marca.id,
            precioVenta: 2,
            variantes: { create: [{ nombre: "Único", sku: "TST-UNO" }] },
          },
          include: { variantes: true },
        });
        await tx.variante.update({
          where: { id: p.variantes[0]!.id },
          data: { deletedAt: new Date() },
        });
      }),
    "debe tener al menos un sabor",
  );
  const creado = await enRollback((tx) =>
    tx.producto.create({
      data: {
        nombre: "Bien cargado",
        marcaId: marca.id,
        precioVenta: 2,
        variantes: { create: [{ nombre: "Único", sku: "TST-OK" }] },
      },
      include: { variantes: true },
    }),
  );
  check(
    creado?.nombre === "Bien cargado" &&
      creado.panelId === VAPES &&
      creado.categoriaId === null &&
      creado.variantes[0]?.precioVenta === null &&
      creado.variantes[0]?.ultimoCosto === null,
    "producto sin categoría + sabor sin precio propio ni costo en la misma tx: OK",
  );

  console.log("E) Ventas confirmadas: se anulan, no se editan");
  const nueva = await enRollback((tx) => ventaConfirmada(tx));
  check(
    nueva?.items.length === 1 && nueva.items[0]?.panelId === VAPES,
    "crear venta CONFIRMADA con ítems en una tx: OK",
  );
  await rechaza(
    "venta CONFIRMADA sin medio de pago",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.$executeRaw`UPDATE "Venta" SET "medioPago" = NULL WHERE "id" = ${venta.id}`;
      }),
    /Venta_medioPago_chk|no se modifica/,
  );
  await rechaza(
    "totales que no cierran con los ítems",
    () =>
      transaccion(ctxVapes, async (tx) =>
        tx.venta.create({
          data: {
            numero: await siguienteNumero(tx, VAPES, "VENTA"),
            depositoId: g1.id,
            usuarioId: owner.id,
            estado: EstadoVenta.CONFIRMADA,
            medioPago: MedioPago.EFECTIVO,
            subtotal: "99999.00",
            descuento: "0",
            total: "99999.00",
            costoTotal: "9500.00",
            gananciaBruta: "90499.00",
            items: {
              create: [
                {
                  varianteId: va.id,
                  cantidad: 1,
                  precioUnitario: "16000.00",
                  costoUnitario: "9500.00",
                  subtotal: "16000.00",
                },
              ],
            },
          },
        }),
      ),
    "no coincide con la suma de ítems",
  );
  await rechaza(
    "modificar un ítem de venta confirmada",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.ventaItem.update({
          where: { id: venta.items[0]!.id },
          data: { precioUnitario: "1.00", subtotal: "2.00" },
        });
      }),
    "no se pueden modificar",
  );
  await rechaza(
    "cambiar el total de una venta confirmada",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.venta.update({
          where: { id: venta.id },
          data: { descuento: "1000.00", total: "31000.00", gananciaBruta: "12000.00" },
        });
      }),
    "no se modifica, se anula",
  );
  await rechaza(
    "borrar una venta confirmada",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.venta.delete({ where: { id: venta.id } });
      }),
    "anulalo",
  );
  const anulada = await enRollback(async (tx) => {
    const venta = await ventaConfirmada(tx);
    return tx.venta.update({
      where: { id: venta.id },
      data: {
        estado: EstadoVenta.ANULADA,
        anuladaAt: new Date(),
        anuladaPorId: owner.id,
        motivoAnulacion: "test",
      },
    });
  });
  check(anulada?.estado === EstadoVenta.ANULADA, "anular una venta confirmada: OK");
  await rechaza(
    "reactivar una venta anulada",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.venta.update({
          where: { id: venta.id },
          data: { estado: EstadoVenta.ANULADA, anuladaAt: new Date(), anuladaPorId: owner.id },
        });
        await tx.venta.update({
          where: { id: venta.id },
          data: { estado: EstadoVenta.CONFIRMADA, anuladaAt: null, anuladaPorId: null },
        });
      }),
    "Transición de estado inválida",
  );
  const transf = await enRollback(async (tx) => {
    const t = await tx.transferencia.create({
      data: {
        numero: await siguienteNumero(tx, VAPES, "TRANSFERENCIA"),
        depositoOrigenId: g1.id,
        depositoDestinoId: g2.id,
        usuarioId: owner.id,
        estado: EstadoTransferencia.COMPLETADA,
        completadaAt: new Date(),
        items: { create: [{ varianteId: va.id, cantidad: 1 }] },
      },
    });
    return tx.transferencia.update({
      where: { id: t.id },
      data: { estado: EstadoTransferencia.ANULADA },
    });
  });
  check(
    transf?.estado === "ANULADA" && transf.completadaAt !== null,
    "transferencia COMPLETADA → ANULADA conserva completadaAt",
  );

  console.log("F) Numeración por panel (Secuencia)");
  const secVapes = () =>
    prisma.secuencia
      .findUniqueOrThrow({ where: { panelId_entidad: { panelId: VAPES, entidad: "DEVOLUCION" } } })
      .then((s) => s.ultimoNumero);
  const vapesAntes = await secVapes();
  const ultimoAntes = (
    await prisma.secuencia.findUniqueOrThrow({
      where: { panelId_entidad: { panelId: ESPECIALES, entidad: "DEVOLUCION" } },
    })
  ).ultimoNumero;
  const numeros = await Promise.all(
    Array.from({ length: 10 }, () =>
      transaccion({ panelId: ESPECIALES }, (tx) => siguienteNumero(tx, ESPECIALES, "DEVOLUCION"), {
        maxRetries: 10,
      }),
    ),
  );
  const ordenados = [...numeros].sort((a, b) => a - b);
  const consecutivos = ordenados.every((n, i) =>
    i === 0 ? n === ultimoAntes + 1 : n === ordenados[i - 1]! + 1,
  );
  check(
    new Set(numeros).size === 10 && consecutivos,
    `10 pedidos simultáneos → números únicos y consecutivos (${ordenados[0]}..${ordenados[9]})`,
  );
  check(
    (await secVapes()) === vapesAntes,
    "la numeración del mismo tipo en otro panel no se movió",
  );
  const perdido = await enRollback((tx) => siguienteNumero(tx, VAPES, "VENTA"));
  const tomado = await enRollback((tx) => siguienteNumero(tx, VAPES, "VENTA"));
  check(
    perdido === tomado,
    `un número tomado en una tx que se deshace no se consume (${perdido} = ${tomado})`,
  );
  await rechaza(
    "retroceder la secuencia",
    () =>
      prisma.secuencia.update({
        where: { panelId_entidad: { panelId: ESPECIALES, entidad: "DEVOLUCION" } },
        data: { ultimoNumero: 0 },
      }),
    "solo puede avanzar",
  );
  await rechaza(
    "borrar la secuencia",
    () =>
      prisma.secuencia.delete({
        where: { panelId_entidad: { panelId: ESPECIALES, entidad: "DEVOLUCION" } },
      }),
    "reiniciaría la numeración",
  );
  await rechaza(
    "mover la secuencia a otro panel",
    () =>
      prisma.$executeRaw`UPDATE "Secuencia" SET "panelId" = ${COSMETIC}, "ultimoNumero" = "ultimoNumero" + 100 WHERE "panelId" = ${ESPECIALES} AND "entidad" = 'DEVOLUCION'`,
    /solo puede avanzar|Unique constraint|duplicate key/,
  );
  await rechaza(
    "entidad de secuencia desconocida",
    () => prisma.secuencia.create({ data: { panelId: ESPECIALES, entidad: "COMPROBANTE" } }),
    "Secuencia_entidad_chk",
  );
  await rechaza(
    "número de compra repetido en el mismo panel",
    () =>
      enRollbackCrudo(async (tx) => {
        const base = {
          numero: 999_999,
          estado: "BORRADOR" as const,
          subtotal: 0,
          total: 0,
          usuarioId: owner.id,
        };
        await tx.compra.create({ data: { ...base, panelId: VAPES, depositoId: g1.id } });
        await tx.compra.create({ data: { ...base, panelId: VAPES, depositoId: g2.id } });
      }),
    "Unique constraint failed",
  );
  await permite("el mismo número de compra en otro panel", () =>
    enRollbackCrudo(async (tx) => {
      const base = {
        numero: 999_999,
        estado: "BORRADOR" as const,
        subtotal: 0,
        total: 0,
        usuarioId: owner.id,
      };
      await tx.compra.create({ data: { ...base, panelId: VAPES, depositoId: g1.id } });
      await tx.compra.create({ data: { ...base, panelId: COSMETIC, depositoId: depCosmetic.id } });
    }),
  );

  console.log("G) Vistas");
  const filasVista = await prisma.$queryRaw<
    { panel_id: string; variante_id: string; total: number; por_deposito: Record<string, number> }[]
  >`SELECT panel_id, variante_id, total, por_deposito FROM vw_stock_consolidado WHERE panel_id = ${VAPES}`;
  const variantesVapes = await db.variante.count({
    where: { deletedAt: null, producto: { deletedAt: null } },
  });
  check(
    filasVista.length === variantesVapes && filasVista.every((f) => f.panel_id === VAPES),
    `vw_stock_consolidado filtrada por panel_id: ${filasVista.length} variantes de Vapes`,
  );
  const depositosVapes = new Set([g1.id, g2.id]);
  check(
    filasVista.every(
      (f) =>
        Object.keys(f.por_deposito).every((d) => depositosVapes.has(d)) &&
        Object.values(f.por_deposito).reduce((a, b) => a + b, 0) === f.total,
    ),
    "por_deposito (jsonb) solo trae depósitos del panel y suma el total",
  );
  const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'vw_stock_consolidado'`;
  const nombresCol = columnas.map((c) => c.column_name);
  check(
    ["panel_id", "total", "por_deposito"].every((c) => nombresCol.includes(c)) &&
      !nombresCol.some((c) => /galp|ayres|mercedes/i.test(c)),
    "vw_stock_consolidado ya no pivotea depósitos en columnas",
  );
  const alertas = await prisma.$queryRaw<{ panel_id: string; variante: string }[]>`
    SELECT panel_id, variante FROM vw_alertas_stock WHERE panel_id = ${VAPES}`;
  check(alertas.length > 0, `vw_alertas_stock devuelve ${alertas.length} alerta(s) de Vapes`);
  const alertasCosmetic = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM vw_alertas_stock WHERE panel_id = ${COSMETIC}`;
  check(
    Number(alertasCosmetic[0]?.n) === 0,
    "vw_alertas_stock de Cosmetic no trae alertas de Vapes",
  );

  console.log("H) Aislamiento entre paneles en la DB");
  await rechaza(
    "producto de Cosmetic con categoría de Vapes",
    () =>
      enRollbackCrudo(async (tx) => {
        const m = await tx.marca.create({ data: { panelId: COSMETIC, nombre: "Cruzada" } });
        await tx.producto.create({
          data: {
            panelId: COSMETIC,
            nombre: "Cruzado",
            marcaId: m.id,
            categoriaId: categoria.id,
            precioVenta: 1,
          },
        });
      }),
    "de otro panel",
  );
  await rechaza(
    "producto de Cosmetic con marca de Vapes",
    () =>
      enRollbackCrudo((tx) =>
        tx.producto.create({
          data: { panelId: COSMETIC, nombre: "Cruzado", marcaId: marca.id, precioVenta: 1 },
        }),
      ),
    "de otro panel",
  );
  await rechaza(
    "venta de Cosmetic desde un depósito de Vapes",
    () =>
      enRollbackCrudo((tx) =>
        tx.venta.create({
          data: {
            panelId: COSMETIC,
            numero: 999_999,
            depositoId: g1.id,
            usuarioId: owner.id,
            subtotal: 0,
            total: 0,
            costoTotal: 0,
            gananciaBruta: 0,
          },
        }),
      ),
    "de otro panel",
  );
  await rechaza(
    "fila de Stock de Cosmetic para una variante de Vapes",
    () =>
      prisma.$executeRaw`INSERT INTO "Stock" ("id","panelId","varianteId","depositoId","cantidad","updatedAt") VALUES ('x', ${COSMETIC}, ${va.id}, ${depCosmetic.id}, 0, now())`,
    "de otro panel",
  );
  await rechaza(
    "movimiento de Cosmetic sobre una variante de Vapes",
    () =>
      prisma.$executeRaw`INSERT INTO "MovimientoStock" ("id","panelId","tipo","varianteId","depositoId","cantidad","stockAnterior","stockPosterior","usuarioId") VALUES ('x', ${COSMETIC}, 'INGRESO_MANUAL', ${va.id}, ${depCosmetic.id}, 1, 0, 1, ${owner.id})`,
    "de otro panel",
  );
  await rechaza(
    "transferencia de Vapes hacia el depósito de Cosmetic",
    () =>
      enRollbackCrudo((tx) =>
        tx.transferencia.create({
          data: {
            panelId: VAPES,
            numero: 999_999,
            depositoOrigenId: g1.id,
            depositoDestinoId: depCosmetic.id,
            usuarioId: owner.id,
          },
        }),
      ),
    "de otro panel",
  );
  await rechaza(
    "mover un cliente a otro panel (panelId no cambia)",
    () =>
      prisma.$executeRaw`UPDATE "Cliente" SET "panelId" = ${COSMETIC} WHERE "panelId" = ${VAPES}`,
    "no se puede cambiar",
  );
  await rechaza(
    "INSERT sin panelId (SQL)",
    () =>
      prisma.$executeRaw`INSERT INTO "Categoria" ("id","nombre","updatedAt") VALUES ('x', 'Sin panel', now())`,
    /panelId|23502/,
  );
  await rechaza(
    "INSERT sin panelId (Prisma crudo)",
    () => prisma.marca.create({ data: { nombre: "Sin panel" } }),
    /panelId|Null constraint/,
  );
  await rechaza(
    "dbPara(Vapes) con panelId de otro panel",
    () => db.cliente.create({ data: { panelId: COSMETIC, nombre: "Intruso" } }),
    "Aislamiento de paneles",
  );
  try {
    await dbPara(VAPES).cliente.findMany({ where: { panelId: COSMETIC } });
    check(false, "dbPara(Vapes) con where de otro panel: NO lanzó");
  } catch (e) {
    check(
      e instanceof PanelAislamientoError,
      "dbPara(Vapes) con where de otro panel → PanelAislamientoError",
    );
  }
  const ajena = await dbPara(COSMETIC).variante.findUnique({ where: { id: va.id } });
  check(ajena === null, "un id de Vapes leído desde Cosmetic da «no encontrado»");
  await rechaza(
    "permiso de empleado sobre un módulo global",
    () =>
      prisma.permisoUsuario.create({
        data: { usuarioId: owner.id, panelId: VAPES, modulo: "USUARIOS", puedeVer: true },
      }),
    "PermisoUsuario_modulo_de_panel_chk",
  );

  console.log("I) Clientes: teléfono normalizado y único por panel");
  const TEL = "+5491100001111";
  await rechaza(
    "teléfono sin normalizar",
    () => db.cliente.create({ data: { nombre: "Tel", telefono: "11 0000-1111" } }),
    "Cliente_telefono_chk",
  );
  await rechaza(
    "teléfono duplicado en el mismo panel",
    () =>
      enRollback(async (tx) => {
        await tx.cliente.create({ data: { nombre: "Uno", telefono: TEL } });
        await tx.cliente.create({ data: { nombre: "Dos", telefono: TEL } });
      }),
    "Unique constraint failed",
  );
  await permite("el mismo teléfono en otro panel", () =>
    enRollbackCrudo(async (tx) => {
      await tx.cliente.create({ data: { panelId: VAPES, nombre: "Uno", telefono: TEL } });
      await tx.cliente.create({ data: { panelId: COSMETIC, nombre: "Dos", telefono: TEL } });
    }),
  );
  await permite("el teléfono de un cliente dado de baja se puede reutilizar", () =>
    enRollback(async (tx) => {
      await tx.cliente.create({ data: { nombre: "Viejo", telefono: TEL, deletedAt: new Date() } });
      await tx.cliente.create({ data: { nombre: "Nuevo", telefono: TEL } });
    }),
  );

  console.log("K) Catálogo: nombre completo, especificación, precios de proveedor, compras");
  const derivados = await enRollback(async (tx) => {
    const mk = await tx.marca.create({ data: { nombre: "Marca Trigger" } });
    const p = await tx.producto.create({
      data: {
        nombre: "  BC   Pro ",
        especificacion: " 5 000 ",
        marcaId: mk.id,
        precioVenta: 100,
        nombreCompleto: "escrito a mano",
        especificacionNorm: "escrito a mano",
        variantes: { create: [{ nombre: "Único", sku: "TST-TRG" }] },
      },
    });
    const pisado = await tx.producto.update({
      where: { id: p.id },
      data: { nombreCompleto: "otra vez a mano" },
    });
    await tx.marca.update({ where: { id: mk.id }, data: { nombre: "Marca Renombrada" } });
    const renombrado = await tx.producto.findUniqueOrThrow({ where: { id: p.id } });
    const sinMarca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Sin marca" } },
      update: {},
      create: { nombre: "Sin marca" },
    });
    const generico = await tx.producto.create({
      data: {
        nombre: "Genérico",
        marcaId: sinMarca.id,
        precioVenta: 1,
        variantes: { create: [{ nombre: "Único", sku: "TST-GEN" }] },
      },
    });
    return { p, pisado, renombrado, generico };
  });
  check(
    derivados.p.nombre === "BC Pro" &&
      derivados.p.especificacion === "5 000" &&
      derivados.p.especificacionNorm === "5000",
    `trigger normaliza modelo/especificación ("${derivados.p.nombre}", "${derivados.p.especificacion}" → norm "${derivados.p.especificacionNorm}")`,
  );
  check(
    derivados.p.nombreCompleto === "Marca Trigger BC Pro 5 000" &&
      derivados.pisado.nombreCompleto === "Marca Trigger BC Pro 5 000",
    `nombreCompleto lo calcula la DB e ignora lo que escriba la app ("${derivados.p.nombreCompleto}")`,
  );
  check(
    derivados.renombrado.nombreCompleto === "Marca Renombrada BC Pro 5 000",
    `renombrar la marca actualiza el nombre completo de sus productos ("${derivados.renombrado.nombreCompleto}")`,
  );
  check(
    derivados.generico.nombreCompleto === "Genérico",
    'la marca "Sin marca" no aparece en el nombre completo',
  );
  await rechaza(
    "mismo marca + modelo + especificación (normalizada) en el panel",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const mk = await tx.marca.create({ data: { nombre: "Marca Dup" } });
        for (const [i, esp] of ["5000", " 50 00 "].entries()) {
          await tx.producto.create({
            data: {
              nombre: "BC",
              especificacion: esp,
              marcaId: mk.id,
              precioVenta: 1,
              variantes: { create: [{ nombre: "Único", sku: `TST-DUP${i}` }] },
            },
          });
        }
      }),
    "Unique constraint failed",
  );
  await permite("mismo modelo con otra especificación (BC 5000 y BC 3000)", () =>
    enRollback(async (tx) => {
      const mk = await tx.marca.create({ data: { nombre: "Marca Esp" } });
      for (const [i, esp] of ["5000", "3000"].entries()) {
        await tx.producto.create({
          data: {
            nombre: "BC",
            especificacion: esp,
            marcaId: mk.id,
            precioVenta: 1,
            variantes: { create: [{ nombre: "Único", sku: `TST-ESP${i}` }] },
          },
        });
      }
    }),
  );

  const otroProducto = await db.producto.findFirstOrThrow({
    where: { id: { not: va.productoId }, deletedAt: null },
  });
  async function compraConItem(tx: Tx, productoId: string) {
    const compra = await tx.compra.create({
      data: {
        numero: await siguienteNumero(tx, VAPES, "COMPRA"),
        depositoId: g1.id,
        usuarioId: owner.id,
        subtotal: "10.00",
        total: "10.00",
      },
    });
    return tx.compraItem.create({
      data: {
        compraId: compra.id,
        varianteId: va.id,
        productoId,
        cantidad: 1,
        costoUnitario: "10.00",
        subtotal: "10.00",
      },
    });
  }
  await rechaza(
    "ítem de compra con productoId que no es el de la variante",
    () => transaccion(ctxVapes, (tx) => compraConItem(tx, otroProducto.id)),
    "no corresponde a la variante",
  );
  const itemOk = await enRollback((tx) => compraConItem(tx, va.productoId));
  check(itemOk?.productoId === va.productoId, "ítem de compra con el producto de su variante: OK");
  await rechaza(
    "cambiar la variante de un ítem de compra a la de otro producto",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const item = await compraConItem(tx, va.productoId);
        const ajena = await tx.variante.findFirstOrThrow({
          where: { productoId: otroProducto.id },
        });
        await tx.compraItem.update({ where: { id: item.id }, data: { varianteId: ajena.id } });
      }),
    "no corresponde a la variante",
  );

  const proveedorVapes = async (tx: Tx) =>
    tx.proveedor.create({ data: { nombre: "Contacto", nombreTienda: "Tienda Test" } });
  await rechaza(
    "precio de proveedor de Vapes para un producto de Cosmetic",
    () =>
      enRollbackCrudo(async (tx) => {
        const prov = await tx.proveedor.create({
          data: { panelId: VAPES, nombre: "Contacto", nombreTienda: "Tienda Vapes" },
        });
        const mk = await tx.marca.create({ data: { panelId: COSMETIC, nombre: "Marca PP" } });
        const prodCos = await tx.producto.create({
          data: {
            panelId: COSMETIC,
            nombre: "Crema",
            marcaId: mk.id,
            precioVenta: 1,
            variantes: { create: [{ panelId: COSMETIC, nombre: "Único", sku: "TST-PP" }] },
          },
        });
        await tx.proveedorProducto.create({
          data: {
            panelId: VAPES,
            proveedorId: prov.id,
            productoId: prodCos.id,
            precio: "10.00",
            usuarioId: owner.id,
          },
        });
      }),
    "de otro panel",
  );
  await rechaza(
    "precio de proveedor de Cosmetic con proveedor y producto de Vapes",
    () =>
      enRollbackCrudo(async (tx) => {
        const prov = await tx.proveedor.create({
          data: { panelId: VAPES, nombre: "Contacto", nombreTienda: "Tienda Vapes" },
        });
        await tx.proveedorProducto.create({
          data: {
            panelId: COSMETIC,
            proveedorId: prov.id,
            productoId: va.productoId,
            precio: "10.00",
            usuarioId: owner.id,
          },
        });
      }),
    "de otro panel",
  );
  await rechaza(
    "dos precios del mismo proveedor para el mismo producto",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const prov = await proveedorVapes(tx);
        for (const precio of ["10.00", "11.00"]) {
          await tx.proveedorProducto.create({
            data: { proveedorId: prov.id, productoId: va.productoId, precio, usuarioId: owner.id },
          });
        }
      }),
    "Unique constraint failed",
  );
  await rechaza(
    "precio de proveedor negativo",
    () =>
      transaccion(ctxVapes, async (tx) => {
        const prov = await proveedorVapes(tx);
        await tx.proveedorProducto.create({
          data: {
            proveedorId: prov.id,
            productoId: va.productoId,
            precio: "-1",
            usuarioId: owner.id,
          },
        });
      }),
    "ProveedorProducto_precio_chk",
  );
  const pp = await enRollback(async (tx) => {
    const prov = await proveedorVapes(tx);
    return tx.proveedorProducto.create({
      data: {
        proveedorId: prov.id,
        productoId: va.productoId,
        precio: "12.50",
        moneda: "USD",
        usuarioId: owner.id,
      },
    });
  });
  check(
    pp?.panelId === VAPES && pp.moneda === "USD",
    "precio de proveedor en USD dentro del panel: OK",
  );
  await rechaza(
    "proveedor sin nombre de tienda",
    () => db.proveedor.create({ data: { nombre: "Contacto", nombreTienda: "  " } }),
    "Proveedor_nombreTienda_chk",
  );
  await rechaza(
    "teléfono de proveedor sin normalizar",
    () =>
      db.proveedor.create({
        data: { nombre: "Contacto", nombreTienda: "Tienda", telefono: "11 5555-0101" },
      }),
    "Proveedor_telefono_chk",
  );
  await rechaza(
    "teléfono de proveedor repetido en el panel",
    () =>
      transaccion(ctxVapes, async (tx) => {
        for (const t of ["Una", "Otra"]) {
          await tx.proveedor.create({
            data: { nombre: "Contacto", nombreTienda: t, telefono: "+541155550199" },
          });
        }
      }),
    "Unique constraint failed",
  );
  check(
    precioVentaEfectivo({ precioVenta: null }, { precioVenta: "15000.00" }) === "15000.00" &&
      precioVentaEfectivo({ precioVenta: "17000.00" }, { precioVenta: "15000.00" }) ===
        "17000.00" &&
      costoParaVenta({ ultimoCosto: null }) === "0.00",
    "sabor sin precio propio usa el del producto; sin costo → snapshot 0",
  );

  console.log("J) Validaciones Zod");
  check(!v.monto.safeParse("").success, 'monto "" es error (no 0)');
  check(v.montoOCero.safeParse("").data === 0, 'descuento "" → 0');
  check(v.montoOpcional.safeParse("").data === undefined, 'monto opcional "" → undefined');
  check(v.monto.safeParse("1500.5").data === 1500.5, 'monto "1500.5" → 1500.5');
  check(!v.monto.safeParse("1.005").success, "monto con 3 decimales es error");
  check(!v.monto.safeParse(-1).success, "monto negativo es error");
  check(v.email.safeParse("  Juan@X.COM ").data === "juan@x.com", "email → trim + minúsculas");
  check(
    v.codigoBarras.safeParse(" 779 0001 000019 ").data === "7790001000019",
    "código de barras sin espacios",
  );
  check(!v.codigoBarras.safeParse("ab").success, "código de barras de 2 caracteres es error");
  check(
    v.codigoBarras.safeParse(" abc-123 ").data === "ABC-123",
    "código alfanumérico → mayúsculas",
  );
  check(
    !v.cantidad.safeParse(1.5).success && !v.cantidad.safeParse(0).success,
    "cantidad no entera o 0 es error",
  );
  const prod = v.productoSchema.safeParse({
    marca: " Elf Bar ",
    modelo: "  BC ",
    especificacion: " 5  000 ",
    precioVenta: "15000",
    sabores: [{ sabor: "" }],
  });
  check(
    prod.success &&
      prod.data.sabores[0]?.nombre === "Único" &&
      prod.data.sabores[0]?.precioVenta === undefined &&
      prod.data.especificacion === "5 000" &&
      prod.data.categoriaId === undefined,
    'producto sin sabor → variante "Único" que usa el precio del producto; categoría opcional',
  );
  check(
    !v.productoSchema.safeParse({
      marca: "X",
      modelo: "Y",
      precioVenta: 2,
      sabores: [{ sabor: "Mango" }, { sabor: "mango" }],
    }).success,
    "sabores repetidos es error",
  );
  check(
    !v.productoSchema.safeParse({
      marca: "",
      modelo: "Y",
      precioVenta: 2,
      sabores: [{ sabor: "" }],
    }).success,
    "producto sin marca es error",
  );
  check(
    !v.productoSchema.safeParse({ marca: "X", modelo: "Y", sabores: [{ sabor: "" }] }).success,
    "producto sin precio de venta es error",
  );
  check(
    !v.borradorVentaSchema.safeParse({
      depositoId: "d",
      items: [
        { varianteId: "a", cantidad: 1, precioUnitario: "" },
        { varianteId: "a", cantidad: 1 },
      ],
    }).success,
    "venta con ítem repetido es error",
  );
  check(
    v.borradorVentaSchema.safeParse({
      depositoId: "d",
      items: [{ varianteId: "a", cantidad: 1, precioUnitario: "" }],
    }).data?.items[0]?.precioUnitario === undefined,
    'precio de ítem "" → undefined (se usa el de lista, no $0)',
  );
  check(
    !v.crearTransferenciaSchema.safeParse({
      depositoOrigenId: "a",
      depositoDestinoId: "a",
      items: [{ varianteId: "x", cantidad: 1 }],
    }).success,
    "transferencia al mismo depósito es error",
  );
  const prov = v.crearProveedorSchema.safeParse({
    nombre: "Juan",
    nombreTienda: "Vapes Once",
    telefono: "011 5555-0101",
  });
  check(
    prov.data?.telefono === "+541155550101" && prov.data.productos.length === 0,
    "proveedor: teléfono → +54 + dígitos; productos opcionales",
  );
  check(
    !v.crearProveedorSchema.safeParse({ nombre: "Juan", nombreTienda: "" }).success,
    "proveedor sin nombre de tienda es error",
  );
  check(
    !v.crearProveedorSchema.safeParse({
      nombre: "Juan",
      nombreTienda: "T",
      productos: [
        { productoId: "p", precio: 1 },
        { productoId: "p", precio: 2, moneda: "USD" },
      ],
    }).success,
    "proveedor con el mismo producto dos veces es error",
  );
  check(
    v.crearClienteSchema.safeParse({ nombre: "C", telefono: "011 5555-0101" }).data?.telefono ===
      "+541155550101" && v.normalizarTelefono("+54 9 11 5555-0101") === "+5491155550101",
    "teléfono de cliente → +54 + dígitos",
  );
  check(
    !v.crearClienteSchema.safeParse({ nombre: "C", telefono: "123" }).success,
    "teléfono de 3 dígitos es error",
  );
  const acceso = v.actualizarAccesoSchema.safeParse({
    usuarioId: "u",
    paneles: [{ panelId: VAPES, permisos: [{ modulo: "VENTAS", puedeCrear: true }] }],
  });
  check(
    acceso.data?.paneles[0]?.permisos[0]?.puedeVer === true,
    "puedeCrear implica puedeVer (por panel)",
  );
  check(
    !v.actualizarAccesoSchema.safeParse({
      usuarioId: "u",
      paneles: [{ panelId: VAPES, permisos: [{ modulo: "USUARIOS", puedeVer: true }] }],
    }).success,
    "el módulo USUARIOS no se asigna a empleados",
  );
  check(
    !v.actualizarAccesoSchema.safeParse({
      usuarioId: "u",
      paneles: [
        { panelId: VAPES, permisos: [] },
        { panelId: VAPES, permisos: [] },
      ],
    }).success,
    "panel repetido en el acceso es error",
  );
  check(!v.password.safeParse("abcdefgh").success, "password sin número es error");
  check(!v.password.safeParse("12345678").success, "password sin letra es error");
  check(v.password.safeParse("clave1234").success, "password con letra y número (8+) es válida");
  check(
    !v.crearUsuarioSchema.safeParse({
      nombre: "A",
      email: "a@b.com",
      password: "corta",
      rol: "OWNER",
    }).success,
    "password débil es error",
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
