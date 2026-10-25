import { mkdirSync } from "node:fs";

import { Modulo, type TipoVenta } from "@prisma/client";
import type { Page } from "@playwright/test";

import { formatearPesos } from "../src/lib/format";
import { mesDe, nombreMes, sumarMeses } from "../src/lib/ganancia-vendedor";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  crearUsuario,
  db,
  esMobile,
  firmarEnCanvas,
  login,
  loginDueno,
  PANEL_VAPES,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Ganancia mensual de Trinidad (A3, bloque 1): por vape vendido según tipo de
 * venta y cliente nuevo. El dueño la ve en "Ventas de Trinidad" (total a hoy,
 * 4 categorías, ventas con su ganancia → detalle, Excel), recibe el aviso del
 * mes cerrado, registra el pago y configura la ganancia de otro vendedor.
 * Trinidad ve lo suyo en el inicio y en "Mi ganancia".
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/a3";
const MES = mesDe(new Date());
const MES_ANTERIOR = sumarMeses(MES, -1);
const n = `${Date.now()}`.slice(-6);
let trinidadId = "";
let tarifaCreada: Date | null = null;
const codigos: string[] = [];

/** Venta confirmada directo en la base (como 20-dashboard), con o sin cliente nuevo. */
async function venta(o: { tipo: TipoVenta; nuevo: boolean; cantidad: number; fecha: Date }) {
  const [variante, deposito] = await Promise.all([
    db.variante.findFirstOrThrow({
      where: { panelId: PANEL_VAPES, deletedAt: null },
      orderBy: { sku: "asc" },
    }),
    db.deposito.findFirstOrThrow({ where: { panelId: PANEL_VAPES, esPrincipal: true } }),
  ]);
  const precio = 10000;
  const total = precio * o.cantidad;
  return db.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({
      data: {
        panelId: PANEL_VAPES,
        nombre: `${o.nuevo ? "Nuevo" : "Habitual"} ${o.tipo.toLowerCase()} ${n}-${codigos.length}`,
        telefono: `+5411${n}${String(10 + codigos.length).padStart(2, "0")}`,
      },
    });
    const s = await tx.secuencia.update({
      where: { panelId_entidad: { panelId: PANEL_VAPES, entidad: "VENTA" } },
      data: { ultimoNumero: { increment: 1 } },
    });
    const codigo = `VAP-${String(s.ultimoNumero).padStart(6, "0")}`;
    codigos.push(codigo);
    return tx.venta.create({
      data: {
        panelId: PANEL_VAPES,
        numero: s.ultimoNumero,
        codigo,
        fecha: o.fecha,
        clienteId: cliente.id,
        depositoId: deposito.id,
        vendedorId: trinidadId,
        tipo: o.tipo,
        clienteNuevo: o.nuevo,
        medioPago: "EFECTIVO",
        montoPagado: total,
        pagos: {
          create: {
            panelId: PANEL_VAPES,
            medioPago: "EFECTIVO",
            monto: total,
            fecha: o.fecha,
            usuarioId: trinidadId,
          },
        },
        subtotal: total,
        total,
        costoTotal: 0,
        gananciaBruta: total,
        items: {
          create: {
            panelId: PANEL_VAPES,
            varianteId: variante.id,
            productoId: variante.productoId,
            cantidad: o.cantidad,
            precioLista: precio,
            precioUnitario: precio,
            costoUnitario: 0,
            subtotal: total,
          },
        },
      },
    });
  });
}

async function captura(page: Page, nombre: string) {
  mkdirSync(CARPETA, { recursive: true });
  const movil = esMobile(page);
  const antes = page.viewportSize();
  // Celular: a 375 px de ancho (el más angosto que se soporta).
  if (movil) await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: `${CARPETA}/trinidad-${nombre}-${movil ? "375" : "1440"}.png`,
    fullPage: true,
  });
  if (movil && antes) await page.setViewportSize(antes);
}

test.beforeAll(async () => {
  const t = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  trinidadId = t.id;
  // Las tarifas "existen" desde el mes anterior: ese mes se liquida solo.
  const tarifa = await db.tarifaVendedor.findUniqueOrThrow({
    where: { panelId_usuarioId: { panelId: PANEL_VAPES, usuarioId: t.id } },
  });
  tarifaCreada = tarifa.createdAt;
  await db.tarifaVendedor.update({
    where: { id: tarifa.id },
    data: { createdAt: new Date(`${MES_ANTERIOR}-01T12:00:00Z`) },
  });
  await db.liquidacionVendedor.deleteMany({ where: { usuarioId: t.id, estado: "PENDIENTE" } });
  const hoy = new Date();
  // Mes en curso: las 4 categorías → 2×1500 + 10×300 + 1×2000 + 4×500 = $ 10.000.
  await venta({ tipo: "UNITARIA", nuevo: false, cantidad: 2, fecha: hoy });
  await venta({ tipo: "MAYORISTA", nuevo: false, cantidad: 10, fecha: hoy });
  await venta({ tipo: "UNITARIA", nuevo: true, cantidad: 1, fecha: hoy });
  await venta({ tipo: "MAYORISTA", nuevo: true, cantidad: 4, fecha: hoy });
  // Mes anterior: 3 vapes minoristas → $ 4.500.
  await venta({
    tipo: "UNITARIA",
    nuevo: false,
    cantidad: 3,
    fecha: new Date(`${MES_ANTERIOR}-15T15:00:00Z`),
  });
});

test.afterAll(async () => {
  if (tarifaCreada)
    await db.tarifaVendedor.updateMany({
      where: { panelId: PANEL_VAPES, usuarioId: trinidadId },
      data: { createdAt: tarifaCreada },
    });
});

test("el dueño ve la ganancia de Trinidad del mes: total, categorías, ventas y Excel", async ({
  page,
}) => {
  await loginDueno(page);
  await page.goto(`/p/vapes/equipo/${trinidadId}`);
  const seccion = page.getByTestId("seccion-ganancia");
  await expect(seccion.getByRole("heading", { name: "Ganancia de Trinidad" })).toBeVisible();
  await expect(seccion.getByTestId("mes-ganancia")).toHaveText(
    nombreMes(MES).replace(/^./, (c) => c.toUpperCase()),
  );
  await expect(seccion.getByTestId("total-ganancia")).toHaveText(formatearPesos(10000));
  const categorias = seccion.getByTestId("categorias-ganancia");
  for (const [cat, monto] of [
    ["Minorista", 3000],
    ["Mayorista", 3000],
    ["Minorista · cliente nuevo", 2000],
    ["Mayorista · cliente nuevo", 2000],
  ] as const) {
    await expect(
      categorias.getByText(cat, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(categorias).toContainText(formatearPesos(monto));
  }
  await captura(page, "ganancia-dueno");

  // Excel del mes.
  const r = await page.request.get(`/api/p/vapes/equipo/${trinidadId}/ganancia?mes=${MES}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-disposition"]).toMatch(/ganancia-trinidad-/);

  // Fila → detalle de la venta.
  const codigo = codigos[3]!;
  if (esMobile(page)) {
    await seccion.getByRole("link").filter({ hasText: codigo }).first().click();
  } else {
    const tabla = seccion.getByRole("table", { name: "Ganancia de Trinidad por venta" });
    const fila = tabla.getByRole("row").filter({ hasText: codigo });
    await expect(fila).toContainText("Mayorista · cliente nuevo");
    await expect(fila).toContainText(formatearPesos(2000));
    await fila.getByRole("link", { name: codigo }).click();
  }
  await expect(page).toHaveURL(/\/p\/vapes\/ventas\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(codigo);
});

test("mes cerrado: aviso al dueño, liquidación automática y pago registrado", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/vapes");
  const aviso = page.getByTestId("aviso-liquidaciones");
  await expect(aviso).toContainText(`Cerró ${nombreMes(MES_ANTERIOR)}`);
  await expect(aviso).toContainText(formatearPesos(4500));
  await captura(page, "aviso-inicio");

  await aviso.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`mes=${MES_ANTERIOR}`));
  const estado = page.getByTestId("estado-liquidacion");
  await expect(estado).toContainText("Pendiente de pago");
  await expect(estado).toContainText("generada automáticamente");
  await estado.getByRole("button", { name: "Registrar pago" }).click();
  const hoja = page.getByRole("dialog", { name: "Pago a Trinidad" });
  await expect(hoja.getByLabel("Monto pagado")).toHaveValue("4500");
  await hoja.getByLabel("Cómo se le pagó").selectOption("TRANSFERENCIA");
  await firmarEnCanvas(page, hoja.getByTestId("firma-canvas"));
  await hoja.getByRole("button", { name: "Firmar y registrar pago" }).click();
  await page
    .getByRole("dialog", { name: "Remito enviado por mail" })
    .getByRole("button", { name: "Listo" })
    .click();
  await expect(estado).toContainText("Pagada");
  await expect(estado).toContainText(`Se le pagaron ${formatearPesos(4500)}`);
  const l = await db.liquidacionVendedor.findFirstOrThrow({
    where: { usuarioId: trinidadId, mes: new Date(`${MES_ANTERIOR}-01T00:00:00Z`) },
  });
  expect(l).toMatchObject({ estado: "PAGADA", medioPago: "TRANSFERENCIA" });
  expect(Number(l.total)).toBe(4500);
  await expect(page.getByTestId("historial-liquidaciones")).toContainText("Pagada · falta firma");
  await captura(page, "liquidacion-pagada");
});

test("el dueño configura la ganancia por vape de otro vendedor", async ({ page }) => {
  test.skip(esMobile(page), "una vez alcanza (escritorio)");
  const v = await crearUsuario({ permisos: [{ modulo: Modulo.VENTAS, ver: true, crear: true }] });
  await loginDueno(page);
  await page.goto(`/p/vapes/equipo/${v.id}`);
  await expect(page.getByTestId("seccion-ganancia")).toHaveCount(0);
  await page.getByRole("button", { name: "Configurar ganancia por vape" }).click();
  const dialogo = page.getByRole("dialog", { name: `Ganancia por vape de ${v.nombre}` });
  await dialogo.getByLabel("Minorista ($ por vape)").fill("1000");
  await dialogo.getByLabel("Mayorista ($ por vape)").fill("200");
  await dialogo.getByLabel("Minorista · cliente nuevo ($ por vape)").fill("1200");
  await dialogo.getByLabel("Mayorista · cliente nuevo ($ por vape)").fill("250");
  await dialogo.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("seccion-ganancia")).toBeVisible();
  const t = await db.tarifaVendedor.findUniqueOrThrow({
    where: { panelId_usuarioId: { panelId: PANEL_VAPES, usuarioId: v.id } },
  });
  expect([t.minorista, t.mayorista, t.minoristaNuevo, t.mayoristaNuevo].map(Number)).toEqual([
    1000, 200, 1200, 250,
  ]);
});

test("Trinidad ve lo que va ganando en el inicio y en «Mi ganancia»", async ({ page }) => {
  await login(page, "trinidad@negocio.com", PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  const tarjeta = page.getByTestId("tarjeta-mi-ganancia");
  await expect(tarjeta).toContainText(`Mi ganancia de ${nombreMes(MES)}`);
  await expect(tarjeta).toContainText(formatearPesos(10000));
  await tarjeta.scrollIntoViewIfNeeded();
  await captura(page, "inicio");
  await tarjeta.click();
  await expect(page).toHaveURL(/\/p\/vapes\/ganancia$/);
  const seccion = page.getByTestId("seccion-ganancia");
  await expect(seccion.getByTestId("total-ganancia")).toHaveText(formatearPesos(10000));
  // Sin acciones de dueño ni datos del negocio.
  await expect(page.getByRole("button", { name: /Ganancia por vape|Registrar pago/ })).toHaveCount(
    0,
  );
  await expect(page.getByText(/margen|costo/i)).toHaveCount(0);
  await captura(page, "mi-ganancia");
  // Su Excel sí; el de otro vendedor, no.
  expect(
    (await page.request.get(`/api/p/vapes/equipo/${trinidadId}/ganancia?mes=${MES}`)).status(),
  ).toBe(200);
  const otro = await db.usuario.findFirstOrThrow({ where: { rol: "OWNER" } });
  expect((await page.request.get(`/api/p/vapes/equipo/${otro.id}/ganancia`)).status()).toBe(403);
});
