/**
 * Pruebas de integridad de la DB (constraints, triggers, vistas) + schemas Zod.
 * Uso: pnpm test:integridad   (requiere migraciones + seed)
 *
 * Casi todo corre en transacciones que terminan en rollback: no deja rastro.
 * Excepción: la prueba de numeración concurrente usa el punto de venta 9999
 * y deja esa secuencia avanzada (`pnpm db:reset` la limpia).
 */
import {
  EstadoTransferencia,
  EstadoVenta,
  MedioPago,
  RolUsuario,
  TipoComprobante,
  TipoMovimiento,
} from "@prisma/client";

import { prisma, withTransaction, type Tx } from "../src/lib/db";
import * as v from "../src/lib/validations";
import { siguienteNumeroComprobante } from "../src/server/services/comprobante.service";
import { registrarMovimiento } from "../src/server/services/stock.service";

let fallos = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};

class Rollback extends Error {}

/** Corre `fn` en una tx y la descarta. Devuelve el resultado de `fn`. */
async function enRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let resultado: T | undefined;
  try {
    await withTransaction(async (tx) => {
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
async function rechaza(desc: string, fn: () => Promise<unknown>, esperado: string) {
  try {
    await fn();
    check(false, `${desc}: NO fue rechazado`);
  } catch (e) {
    if (e instanceof Rollback) return check(false, `${desc}: NO fue rechazado`);
    const m = mensaje(e);
    check(m.includes(esperado), `${desc} → "${m}"`);
  }
}

async function main() {
  const owner = await prisma.usuario.findFirstOrThrow({ where: { rol: RolUsuario.OWNER } });
  const [g1, g2] = await prisma.deposito.findMany({ orderBy: { nombre: "asc" } });
  if (!g1 || !g2) throw new Error("Faltan depósitos: corré `pnpm db:seed`");
  const [va, vb] = await prisma.variante.findMany({
    where: { producto: { nombre: "Ignite V80" } },
    orderBy: { nombre: "asc" },
    include: { codigosAlternativos: true },
  });
  if (!va || !vb) throw new Error("Faltan variantes de seed");
  const categoria = await prisma.categoria.findFirstOrThrow();
  const altMango = await prisma.codigoBarrasAlternativo.findFirstOrThrow();

  /** Crea una venta CONFIRMADA consistente y "olvida" que se creó en esta tx. */
  async function ventaConfirmada(tx: Tx) {
    const venta = await tx.venta.create({
      data: {
        depositoId: g1!.id,
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
  // Nota: Postgres devuelve unique_violation (23505) tanto de los índices como del
  // trigger de unicidad cruzada; Prisma lo expone como P2002 "Unique constraint failed".
  // El mensaje amigable lo da assertCodigoBarrasDisponible() en el servicio.
  await rechaza(
    "precioVenta negativo (alta de variante)",
    () =>
      prisma.variante.create({
        data: {
          productoId: va.productoId,
          nombre: "Negativa",
          sku: "TST-NEG",
          precioCosto: 1,
          precioVenta: "-1",
        },
      }),
    "Variante_precioVenta_chk",
  );
  // Un UPDATE de precio ni siquiera llega al CHECK: sin HistorialPrecio en la misma tx, el trigger lo frena antes.
  await rechaza(
    "cambio de precio directo (sin historial)",
    () => prisma.variante.update({ where: { id: va.id }, data: { precioVenta: "-1" } }),
    "sin HistorialPrecio",
  );
  await rechaza(
    "segundo depósito principal",
    () => prisma.deposito.update({ where: { id: g2.id }, data: { esPrincipal: true } }),
    "Unique constraint failed on the fields: (`esPrincipal`)",
  );
  await rechaza(
    "email con mayúsculas",
    () =>
      prisma.$executeRaw`UPDATE "Usuario" SET "email" = 'X@NEGOCIO.COM' WHERE "id" = ${owner.id}`,
    "Usuario_email_lowercase_chk",
  );
  await rechaza(
    "código de barras con espacios",
    () => prisma.variante.update({ where: { id: va.id }, data: { codigoBarras: "779 000" } }),
    "Variante_codigoBarras_chk",
  );
  await rechaza(
    "alternativo = código principal de otra variante",
    () =>
      prisma.codigoBarrasAlternativo.create({
        data: { varianteId: va.id, codigo: vb.codigoBarras! },
      }),
    "Unique constraint failed",
  );
  await rechaza(
    "principal = código alternativo existente",
    () => prisma.variante.update({ where: { id: vb.id }, data: { codigoBarras: altMango.codigo } }),
    "Unique constraint failed",
  );
  await rechaza(
    "código de barras duplicado entre variantes",
    () => prisma.variante.update({ where: { id: vb.id }, data: { codigoBarras: va.codigoBarras } }),
    "Unique constraint failed on the fields: (`codigoBarras`)",
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
        categoriaId: categoria.id,
        tieneVariantes: false,
        variantes: {
          create: [
            {
              nombre: "Único",
              sku: "TST-REUSO",
              codigoBarras: va.codigoBarras,
              precioCosto: 1,
              precioVenta: 2,
            },
          ],
        },
      },
    });
    return p.id;
  });
  check(reuso !== undefined, "un código de una variante dada de baja se puede reutilizar");

  console.log("B) Stock y ledger");
  await rechaza(
    "INSERT en Stock con cantidad > 0",
    () =>
      prisma.$executeRaw`INSERT INTO "Stock" ("id","varianteId","depositoId","cantidad","updatedAt") VALUES ('x', ${va.id}, 'dep-inexistente', 5, now())`,
    "se crean con cantidad 0",
  );
  await rechaza(
    "DELETE en Stock",
    () => prisma.stock.deleteMany({ where: { varianteId: va.id } }),
    'No se pueden borrar filas de "Stock"',
  );
  await rechaza(
    "movimiento sin aplicar a Stock (falla al COMMIT)",
    () =>
      withTransaction(async (tx) => {
        const s = await tx.stock.findUniqueOrThrow({
          where: { varianteId_depositoId: { varianteId: va.id, depositoId: g1.id } },
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
      withTransaction(async (tx) => {
        const s = await tx.stock.findUniqueOrThrow({
          where: { varianteId_depositoId: { varianteId: va.id, depositoId: g1.id } },
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
      withTransaction((tx) =>
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
      registrarMovimiento(prisma, {
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
    () => prisma.producto.delete({ where: { id: va.productoId } }),
    "usá soft delete",
  );
  await rechaza(
    "DELETE Usuario",
    () => prisma.usuario.delete({ where: { id: owner.id } }),
    "usá soft delete",
  );
  await rechaza(
    "DELETE Depósito",
    () => prisma.deposito.delete({ where: { id: g2.id } }),
    "desactivalo",
  );

  console.log("D) Producto ↔ variantes (verificado al COMMIT)");
  await rechaza(
    "producto sin variantes",
    () =>
      withTransaction((tx) =>
        tx.producto.create({
          data: { nombre: "Huérfano", categoriaId: categoria.id, tieneVariantes: true },
        }),
      ),
    "debe tener al menos una variante",
  );
  await rechaza(
    "producto 'sin variantes' con dos variantes",
    () =>
      withTransaction((tx) =>
        tx.producto.create({
          data: {
            nombre: "Mal cargado",
            categoriaId: categoria.id,
            tieneVariantes: false,
            variantes: {
              create: [
                { nombre: "Único", sku: "TST-A", precioCosto: 1, precioVenta: 2 },
                { nombre: "Otro", sku: "TST-B", precioCosto: 1, precioVenta: 2 },
              ],
            },
          },
        }),
      ),
    'exactamente una variante "Único"',
  );
  await rechaza(
    "dar de baja la única variante de un producto vivo",
    () =>
      withTransaction(async (tx) => {
        const unico = await tx.variante.findFirstOrThrow({
          where: { producto: { tieneVariantes: false } },
        });
        await tx.variante.update({ where: { id: unico.id }, data: { deletedAt: new Date() } });
      }),
    "debe tener al menos una variante",
  );
  const creado = await enRollback((tx) =>
    tx.producto.create({
      data: {
        nombre: "Bien cargado",
        categoriaId: categoria.id,
        tieneVariantes: false,
        variantes: { create: [{ nombre: "Único", sku: "TST-OK", precioCosto: 1, precioVenta: 2 }] },
      },
    }),
  );
  check(creado?.nombre === "Bien cargado", "producto + variante 'Único' en la misma tx: OK");

  console.log("E) Ventas confirmadas: se anulan, no se editan");
  const nueva = await enRollback((tx) => ventaConfirmada(tx));
  check(nueva?.items.length === 1, "crear venta CONFIRMADA con ítems en una tx: OK");
  await rechaza(
    "totales que no cierran con los ítems",
    () =>
      withTransaction((tx) =>
        tx.venta.create({
          data: {
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
      withTransaction(async (tx) => {
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
      withTransaction(async (tx) => {
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
      withTransaction(async (tx) => {
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
      withTransaction(async (tx) => {
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

  console.log("F) Comprobantes");
  const PV = 9999;
  const numeros = await Promise.all(
    Array.from({ length: 10 }, () =>
      withTransaction((tx) => siguienteNumeroComprobante(tx, TipoComprobante.TICKET, PV), {
        maxRetries: 10,
      }),
    ),
  );
  const ordenados = [...numeros].sort((a, b) => a - b);
  const consecutivos = ordenados.every((n, i) => i === 0 || n === ordenados[i - 1]! + 1);
  check(
    new Set(numeros).size === 10 && consecutivos,
    `10 pedidos simultáneos → números únicos y consecutivos (${ordenados[0]}..${ordenados[9]})`,
  );
  await rechaza(
    "comprobante con número que no salió de la secuencia",
    () =>
      withTransaction(async (tx) => {
        const venta = await ventaConfirmada(tx);
        await tx.comprobante.create({
          data: {
            ventaId: venta.id,
            tipo: TipoComprobante.TICKET,
            puntoVenta: PV,
            numero: 1_000_000,
            total: venta.total,
          },
        });
      }),
    "no fue asignado por SecuenciaComprobante",
  );
  await rechaza(
    "modificar el total de un comprobante emitido",
    () =>
      withTransaction(async (tx) => {
        const venta = await ventaConfirmada(tx);
        const numero = await siguienteNumeroComprobante(tx, TipoComprobante.TICKET, PV);
        const c = await tx.comprobante.create({
          data: {
            ventaId: venta.id,
            tipo: TipoComprobante.TICKET,
            puntoVenta: PV,
            numero,
            total: venta.total,
          },
        });
        await tx.comprobante.update({ where: { id: c.id }, data: { total: "1.00" } });
      }),
    "no se modifica",
  );
  await rechaza(
    "retroceder la secuencia",
    () =>
      prisma.secuenciaComprobante.update({
        where: { tipo_puntoVenta: { tipo: TipoComprobante.TICKET, puntoVenta: PV } },
        data: { ultimoNumero: 0 },
      }),
    "solo puede avanzar",
  );

  console.log("G) Vistas");
  const columnas = await enRollback(async (tx) => {
    await tx.deposito.create({ data: { nombre: "Galpón 3" } });
    return tx.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'vw_stock_consolidado' ORDER BY ordinal_position`;
  });
  const nombresCol = columnas.map((c) => c.column_name);
  check(
    ["Galpón 1", "Galpón 2", "Galpón 3"].every((n) => nombresCol.includes(n)),
    `crear un depósito agrega su columna a vw_stock_consolidado (${nombresCol.slice(-3).join(", ")})`,
  );
  const alertas = await prisma.$queryRaw<
    { variante: string }[]
  >`SELECT variante FROM vw_alertas_stock`;
  check(alertas.length > 0, `vw_alertas_stock devuelve ${alertas.length} alerta(s)`);

  console.log("H) Validaciones Zod");
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
    nombre: " Cargador ",
    categoriaId: "c",
    tieneVariantes: false,
    variantes: [{ nombre: "lo que sea", precioCosto: "10", precioVenta: 20 }],
  });
  check(
    prod.success && prod.data.variantes[0]?.nombre === "Único",
    'producto sin variantes → variante "Único"',
  );
  check(
    !v.productoSchema.safeParse({
      nombre: "X",
      categoriaId: "c",
      tieneVariantes: true,
      variantes: [
        { nombre: "Mango", precioCosto: 1, precioVenta: 2 },
        { nombre: "mango", precioCosto: 1, precioVenta: 2 },
      ],
    }).success,
    "variantes repetidas es error",
  );
  check(
    !v.crearVentaSchema.safeParse({
      depositoId: "d",
      medioPago: "EFECTIVO",
      items: [
        { varianteId: "a", cantidad: 1, precioUnitario: "" },
        { varianteId: "a", cantidad: 1 },
      ],
    }).success,
    "venta con ítem repetido es error",
  );
  check(
    v.crearVentaSchema.safeParse({
      depositoId: "d",
      medioPago: "EFECTIVO",
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
  check(
    v.crearProveedorSchema.safeParse({ nombre: "P", cuit: "20-12345678-6" }).data?.cuit ===
      "20123456786",
    "CUIT válido normalizado",
  );
  check(
    !v.crearProveedorSchema.safeParse({ nombre: "P", cuit: "20-12345678-0" }).success,
    "CUIT con dígito verificador inválido es error",
  );
  const perm = v.actualizarPermisosSchema.safeParse({
    usuarioId: "u",
    permisos: [{ modulo: "VENTAS", puedeCrear: true }],
  });
  check(perm.data?.permisos[0]?.puedeVer === true, "puedeCrear implica puedeVer");
  check(
    !v.actualizarPermisosSchema.safeParse({
      usuarioId: "u",
      permisos: [{ modulo: "USUARIOS", puedeVer: true }],
    }).success,
    "el módulo USUARIOS no se asigna a empleados",
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
