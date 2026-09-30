import { execFileSync } from "node:child_process";

import { limpiarNegocio } from "../../scripts/lib/limpieza-negocio";
import { URL_TEST } from "../../playwright.config";
import { test } from "../base";
import { db } from "../db";

/**
 * Datos de negocio de los E2E: el seed base ya no trae catálogo, así que cada
 * spec que lo necesita lo siembra en `beforeAll` (catálogo de ejemplo de
 * Vapes, con los servicios reales: e2e/fixtures/catalogo-ejemplo.ts) y, en
 * `afterAll`, vacía los datos de negocio de la base de test (lo sembrado y lo
 * que el spec creó). Paneles, depósitos, usuarios y configuración quedan.
 */
export function sembrarCatalogoEjemplo() {
  execFileSync("npx", ["tsx", "--conditions=react-server", "e2e/fixtures/catalogo-ejemplo.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: URL_TEST,
      DIRECT_URL: URL_TEST,
      PRISMA_LOG: "silent",
      LOG_LEVEL: "silent",
    },
    stdio: "pipe",
  });
}

export async function limpiarDatosDeNegocio() {
  await limpiarNegocio(db);
}

/** Registra el beforeAll (sembrar) y el afterAll (limpiar) del spec que lo llama. */
export function usarCatalogoEjemplo() {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    sembrarCatalogoEjemplo();
  });
  test.afterAll(async () => {
    await limpiarDatosDeNegocio();
  });
}

/** Para specs que crean sus propios datos de negocio: los borra al terminar el spec. */
export function limpiarAlTerminar() {
  test.afterAll(async () => {
    await limpiarDatosDeNegocio();
  });
}

/**
 * La última venta confirmada de Vapes; si no hay (el spec corre solo, o en el
 * proyecto celular, donde los flujos que venden se saltean), arma una directo
 * en la base con el primer sabor del catálogo de ejemplo.
 */
export async function ventaConfirmadaVapes() {
  const PANEL = "pnl_vapes";
  const existente = await db.venta.findFirst({
    where: { panelId: PANEL, estado: "CONFIRMADA" },
    orderBy: { fecha: "desc" },
  });
  if (existente) return existente;
  const [variante, deposito, cliente, dueno] = await Promise.all([
    db.variante.findFirstOrThrow({
      where: { panelId: PANEL, deletedAt: null },
      include: { producto: true },
      orderBy: { sku: "asc" },
    }),
    db.deposito.findFirstOrThrow({ where: { panelId: PANEL, esPrincipal: true } }),
    db.cliente.findFirstOrThrow({ where: { panelId: PANEL, deletedAt: null } }),
    db.usuario.findFirstOrThrow({ where: { rol: "OWNER", deletedAt: null } }),
  ]);
  const precio = Number(variante.precioVenta ?? variante.producto.precioVenta);
  const costo = Number(variante.ultimoCosto ?? 0);
  return db.$transaction(async (tx) => {
    const s = await tx.secuencia.update({
      where: { panelId_entidad: { panelId: PANEL, entidad: "VENTA" } },
      data: { ultimoNumero: { increment: 1 } },
    });
    return tx.venta.create({
      data: {
        panelId: PANEL,
        numero: s.ultimoNumero,
        codigo: `VAP-${String(s.ultimoNumero).padStart(6, "0")}`,
        clienteId: cliente.id,
        depositoId: deposito.id,
        vendedorId: dueno.id,
        medioPago: "EFECTIVO",
        montoPagado: precio,
        pagos: {
          create: { panelId: PANEL, medioPago: "EFECTIVO", monto: precio, usuarioId: dueno.id },
        },
        subtotal: precio,
        total: precio,
        costoTotal: costo,
        gananciaBruta: precio - costo,
        items: {
          create: {
            panelId: PANEL,
            varianteId: variante.id,
            productoId: variante.productoId,
            cantidad: 1,
            precioLista: precio,
            precioUnitario: precio,
            costoUnitario: costo,
            subtotal: precio,
          },
        },
      },
    });
  });
}
