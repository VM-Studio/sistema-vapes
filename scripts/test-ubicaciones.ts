/**
 * Ubicaciones de productos y «¿La retira una moto?» (v2.14.0), panel Vapes:
 *  1. Un dueño crea lugares, los ordena y asigna modelos; un empleado no puede.
 *  2. Una venta de Mercedes con «Escanea Charly» y «moto: sí»: en la lista de
 *     Charly viene el nombre del cliente, el aviso de moto y la ubicación de
 *     cada producto. Sin moto, retiraMoto = false.
 *  3. Borrar un lugar deja sus modelos sin ubicación.
 *  4. La base no deja asignar una ubicación de otro panel.
 * Uso: scripts/db-descartable.sh gestion_test && DATABASE_URL=…/gestion_test pnpm test:ubicaciones
 */
import { RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { ForbiddenError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import { listarPendientesDeEscaneo } from "../src/server/services/escaneo-remoto.service";
import { registrarAjuste } from "../src/server/services/movimiento.service";
import {
  asignarUbicacion,
  crearUbicacion,
  datosUbicaciones,
  eliminarUbicacion,
  moverUbicacion,
} from "../src/server/services/ubicacion.service";
import { generarVenta, obtenerVenta } from "../src/server/services/venta.service";

const VAPES = "pnl_vapes";

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

async function main() {
  const base = new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  if (!base || base === "gestion")
    throw new Error(`test-ubicaciones crea datos: usá una base descartable ("${base}").`);
  console.log(`Base: ${base}`);
  const owner = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const empleado = await prisma.usuario.findFirstOrThrow({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: VAPES } } },
    orderBy: { createdAt: "asc" },
  });
  const meta = { ip: "127.0.0.1", userAgent: "test-ubicaciones" };
  const ctx: Ctx = { panelId: VAPES, usuarioId: owner.id, meta };
  const ctxEmp: Ctx = { panelId: VAPES, usuarioId: empleado.id, meta };
  const db = dbPara(VAPES);
  const mercedes = await db.deposito.findFirstOrThrow({ where: { nombre: "Mercedes" } });

  const suf = String(Date.now()).slice(-7);
  const productos = await transaccion(ctx, async (tx) => {
    const marca = await tx.marca.upsert({
      where: { panelId_nombre: { panelId: VAPES, nombre: "Test Ubic" } },
      update: {},
      create: { nombre: "Test Ubic" },
    });
    const crear = (nombre: string, sku: string) =>
      tx.producto.create({
        data: {
          marcaId: marca.id,
          nombre: `${nombre} ${suf}`,
          especificacion: "8000",
          precioVenta: "12000.00",
          variantes: { create: [{ nombre: "Uva", sku: `${sku}-${suf}`, ultimoCostoUsdt: "3.00" }] },
        },
        include: { variantes: true },
      });
    return { a: await crear("Pod A", "TU-A"), b: await crear("Pod B", "TU-B") };
  });
  for (const p of [productos.a, productos.b])
    await registrarAjuste(ctx, {
      depositoId: mercedes.id,
      varianteId: p.variantes[0]!.id,
      cantidadReal: 10,
      motivo: "Preparación test-ubicaciones",
    });

  // ---------------------------------------------------------------------------
  console.log("\n1) Lugares y asignación");
  const e1 = await crearUbicacion(ctx, { nombre: "Estante A · fila 1", descripcion: "arriba" });
  const e2 = await crearUbicacion(ctx, { nombre: "Estante B · fila 3" });
  const dup = await error(() => crearUbicacion(ctx, { nombre: "Estante A · fila 1" }));
  check(dup !== null, "nombre repetido → error");
  const emp = await error(() => crearUbicacion(ctxEmp, { nombre: "X" }));
  check(emp instanceof ForbiddenError, "un empleado no puede crear lugares");
  await moverUbicacion(ctx, e2.id, -1);
  let d = await datosUbicaciones(ctx);
  check(
    d.ubicaciones[0]?.id === e2.id && d.ubicaciones[1]?.id === e1.id,
    "se reordenan (B arriba de A)",
  );
  await asignarUbicacion(ctx, [productos.a.id], e1.id);
  await asignarUbicacion(ctx, [productos.b.id], e2.id);
  d = await datosUbicaciones(ctx);
  check(
    d.productos.find((p) => p.id === productos.a.id)?.ubicacionId === e1.id &&
      d.ubicaciones.find((u) => u.id === e2.id)?.productos === 1,
    "modelos asignados (A → Estante A, B → Estante B)",
  );
  const empAsigna = await error(() => asignarUbicacion(ctxEmp, [productos.a.id], null));
  check(empAsigna instanceof ForbiddenError, "un empleado no puede asignar");

  // ---------------------------------------------------------------------------
  console.log("\n2) Lo que ve Charly");
  const cliente = await crearCliente(ctx, {
    nombre: `Martina Bolsa ${suf}`,
    telefono: `11${suf}7`,
    origenId: owner.id,
  });
  const venta = await generarVenta(
    ctx,
    generarVentaSchema.parse({
      depositoId: mercedes.id,
      cliente: { id: cliente.id },
      items: [
        { varianteId: productos.a.variantes[0]!.id, cantidad: 1 },
        { varianteId: productos.b.variantes[0]!.id, cantidad: 2 },
      ],
      pagos: [{ medioPago: "EFECTIVO", monto: 36000 }],
      escaneoRemoto: true,
      retiraMoto: true,
    }),
    { puedeEditar: true },
  );
  const lista = await listarPendientesDeEscaneo(ctx);
  const v = lista.find((x) => x.id === venta.id);
  check(v?.cliente === `Martina Bolsa ${suf}`, `nombre del cliente: ${v?.cliente}`);
  check(v?.retiraMoto === true, "aviso: la retira una moto");
  const ubic = Object.fromEntries((v?.items ?? []).map((i) => [i.productoId, i.ubicacion]));
  check(
    ubic[productos.a.id] === "Estante A · fila 1" && ubic[productos.b.id] === "Estante B · fila 3",
    `ubicación de cada producto (${Object.values(ubic).join(", ")})`,
  );
  const detalle = await obtenerVenta(ctx, venta.id, { verCostos: true });
  check(detalle.retiraMoto === true, "el detalle de la venta dice «Sí, una moto»");
  const sinMoto = await generarVenta(
    ctx,
    generarVentaSchema.parse({
      depositoId: mercedes.id,
      cliente: { id: cliente.id },
      items: [{ varianteId: productos.a.variantes[0]!.id, cantidad: 1 }],
      pagos: [{ medioPago: "EFECTIVO", monto: 12000 }],
      escaneoRemoto: true,
    }),
    { puedeEditar: true },
  );
  const v2 = (await listarPendientesDeEscaneo(ctx)).find((x) => x.id === sinMoto.id);
  check(v2?.retiraMoto === false, "sin marcar: no la retira una moto");

  // ---------------------------------------------------------------------------
  console.log("\n3) Borrar un lugar");
  const r = await eliminarUbicacion(ctx, e1.id);
  const pa = await db.producto.findUniqueOrThrow({ where: { id: productos.a.id } });
  check(r.productos === 1 && pa.ubicacionId === null, "el modelo queda sin ubicación");
  const v3 = (await listarPendientesDeEscaneo(ctx)).find((x) => x.id === venta.id);
  check(
    v3?.items.find((i) => i.productoId === productos.a.id)?.ubicacion === null,
    "Charly lo ve sin ubicación",
  );

  // ---------------------------------------------------------------------------
  console.log("\n4) Otro panel");
  const ajena = await transaccion({ ...ctx, panelId: "pnl_cosmetic" }, (tx) =>
    tx.ubicacion.create({ data: { nombre: `Cosmética ${suf}` } }),
  );
  const cruzado = await error(() =>
    prisma.producto.update({ where: { id: productos.b.id }, data: { ubicacionId: ajena.id } }),
  );
  check(cruzado !== null, "la base rechaza una ubicación de otro panel");

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} chequeo(s) fallaron`);
  if (fallos > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
