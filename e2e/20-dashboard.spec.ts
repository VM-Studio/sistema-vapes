import type { Page } from "@playwright/test";
import { Modulo, TipoVenta } from "@prisma/client";

import bcrypt from "bcryptjs";

import { formatearPesos } from "../src/lib/format";
import { diaEn, inicioDia, sumarDias, ZONA_DEFAULT } from "../src/lib/zona-horaria";
import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, login, loginDueno, PANEL_COSMETIC, PANEL_VAPES } from "./helpers";

/**
 * Otros specs también venden en Vapes hoy: los KPIs del panel se comparan con
 * lo que dice la base al momento de mirar, y las cifras exactas se verifican
 * con una vendedora propia de este spec (sus ventas son solo las de acá).
 */
const VENDEDORA = { nombre: "Vendedora Dashboard", email: "vendedora-dashboard@negocio.com" };

/** Facturado y unidades de Vapes en un día (zona del negocio), según la base. */
async function totalesDelDia(desplazamiento: number) {
  const dia = sumarDias(diaEn(new Date(), ZONA_DEFAULT), desplazamiento);
  const fecha = {
    gte: inicioDia(dia, ZONA_DEFAULT),
    lt: inicioDia(sumarDias(dia, 1), ZONA_DEFAULT),
  };
  const [v, i] = await Promise.all([
    db.venta.aggregate({
      where: { panelId: PANEL_VAPES, estado: "CONFIRMADA", fecha },
      _sum: { total: true },
    }),
    db.ventaItem.aggregate({
      where: { panelId: PANEL_VAPES, venta: { estado: "CONFIRMADA", fecha } },
      _sum: { cantidad: true },
    }),
  ]);
  return { facturado: Number(v._sum.total ?? 0), unidades: i._sum.cantidad ?? 0 };
}

/**
 * Dashboard con analítica (R5): modos de período con su comparación, el
 * rendimiento del equipo (unitarias / mayoristas / comisión estimada), la
 * vista de un empleado ("Mi rendimiento", sin ganancia ni equipo, export 403)
 * y la etiqueta de unidades por panel.
 */

const HORA = 3600_000;

async function trinidad() {
  return db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
}

/** Venta confirmada cargada directo en la base (numeración por Secuencia, en una transacción). */
async function venta(opciones: {
  vendedorId: string;
  tipo: TipoVenta;
  fecha: Date;
  cantidad: number;
  precio: number;
  costo: number;
}) {
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, deletedAt: null },
    orderBy: { sku: "asc" },
  });
  const deposito = await db.deposito.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, esPrincipal: true },
  });
  const cliente = await db.cliente.findFirstOrThrow({ where: { panelId: PANEL_VAPES } });
  const total = opciones.cantidad * opciones.precio;
  const costo = opciones.cantidad * opciones.costo;
  await db.$transaction(async (tx) => {
    const s = await tx.secuencia.update({
      where: { panelId_entidad: { panelId: PANEL_VAPES, entidad: "VENTA" } },
      data: { ultimoNumero: { increment: 1 } },
    });
    await tx.venta.create({
      data: {
        panelId: PANEL_VAPES,
        numero: s.ultimoNumero,
        codigo: `VAP-${String(s.ultimoNumero).padStart(6, "0")}`,
        fecha: opciones.fecha,
        clienteId: cliente.id,
        depositoId: deposito.id,
        vendedorId: opciones.vendedorId,
        tipo: opciones.tipo,
        medioPago: "EFECTIVO",
        subtotal: total,
        total,
        costoTotal: costo,
        gananciaBruta: total - costo,
        items: {
          create: {
            panelId: PANEL_VAPES,
            varianteId: variante.id,
            productoId: variante.productoId,
            cantidad: opciones.cantidad,
            precioLista: opciones.precio,
            precioUnitario: opciones.precio,
            costoUnitario: opciones.costo,
            subtotal: total,
          },
        },
      },
    });
  });
}

/** Click en un link del router que reintenta mientras la página hidrata (bajo carga tarda). */
async function irCon(page: Page, clic: () => Promise<void>, url: RegExp) {
  await expect(async () => {
    if (!url.test(page.url())) await clic();
    await expect(page).toHaveURL(url, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const t = await trinidad();
  await db.usuario.update({
    where: { id: t.id },
    data: { comisionUnitariaPct: 5, comisionMayoristaPct: 3 },
  });
  // Vendedora propia del spec: EMPLEADO de Vapes con comisión 5 % / 3 %.
  const v = await db.usuario.upsert({
    where: { email: VENDEDORA.email },
    update: {},
    create: {
      ...VENDEDORA,
      rol: "EMPLEADO",
      passwordHash: await bcrypt.hash("VendedoraE2E2026", 10),
      comisionUnitariaPct: 5,
      comisionMayoristaPct: 3,
      paneles: { create: { panelId: PANEL_VAPES } },
    },
  });
  for (const u of [t.id, v.id]) {
    await db.permisoUsuario.upsert({
      where: {
        usuarioId_panelId_modulo: { usuarioId: u, panelId: PANEL_VAPES, modulo: Modulo.DASHBOARD },
      },
      create: { usuarioId: u, panelId: PANEL_VAPES, modulo: Modulo.DASHBOARD, puedeVer: true },
      update: { puedeVer: true },
    });
  }
  // Los dos proyectos (escritorio y celular) comparten la base: las ventas se cargan una vez.
  if (await db.venta.count({ where: { panelId: PANEL_VAPES, vendedorId: v.id } })) return;
  const ahora = Date.now();
  // Hoy: 1 unitaria de $ 20.000 y 1 mayorista de $ 100.000. Ayer: 1 unitaria de $ 10.000.
  await venta({
    vendedorId: v.id,
    tipo: "UNITARIA",
    fecha: new Date(ahora - 60_000),
    cantidad: 2,
    precio: 10_000,
    costo: 6_000,
  });
  await venta({
    vendedorId: v.id,
    tipo: "MAYORISTA",
    fecha: new Date(ahora - 120_000),
    cantidad: 10,
    precio: 10_000,
    costo: 6_000,
  });
  await venta({
    vendedorId: v.id,
    tipo: "UNITARIA",
    fecha: new Date(ahora - 24 * HORA),
    cantidad: 1,
    precio: 10_000,
    costo: 6_000,
  });
});

test("dueño: los cuatro modos con su comparación y sus ejes", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/vapes");
  const comparacion = page.getByTestId("texto-comparacion");
  const grafico = page.getByTestId("tarjeta-grafico");
  const eje = (t: string) => grafico.locator("svg text").getByText(t, { exact: true }).first();

  await expect(comparacion).toContainText("vs. ayer");
  await expect(grafico).toContainText("Hoy vs. ayer");
  await expect(eje("00 h")).toBeVisible();
  await expect(page.getByTestId("kpi-Ganancia")).toContainText("margen");
  // Los KPIs del día coinciden con la base (hoy) y muestran lo de ayer como referencia.
  const hoy = await totalesDelDia(0);
  await expect(page.getByTestId("kpi-Vapes vendidos")).toContainText(String(hoy.unidades));
  await expect(page.getByTestId("kpi-Facturado")).toContainText(formatearPesos(hoy.facturado));
  await expect(page.getByTestId("kpi-Facturado")).toContainText("%");

  await irCon(
    page,
    () => page.getByRole("link", { name: "Semanal", exact: true }).click(),
    /modo=semanal/,
  );
  await expect(comparacion).toContainText("vs. semana pasada");
  await expect(grafico).toContainText("Esta semana vs. la anterior");
  await expect(eje("Lun")).toBeVisible();

  await irCon(
    page,
    () => page.getByRole("link", { name: "Mensual", exact: true }).click(),
    /modo=mensual/,
  );
  await expect(comparacion).toContainText("vs. mes pasado");
  await expect(grafico).toContainText("Este mes vs. el anterior");
  await expect(eje("1")).toBeVisible();

  await irCon(
    page,
    async () => {
      const presets = page.getByRole("link", { name: "Últimos 7 días" });
      if (!(await presets.isVisible())) await page.getByRole("button", { name: "Período" }).click();
      await presets.click({ timeout: 3_000 });
    },
    /modo=periodo/,
  );
  await expect(comparacion).toContainText(/vs\. \d+ \w+ – \d+ \w+ \d{4}/);
  await expect(grafico).toContainText("Este período vs. el anterior");
  await expect(eje("Día 1")).toBeVisible();
});

test("dueño: tarjeta de una vendedora con unitarias, mayoristas y comisión estimada", async ({
  page,
}) => {
  await loginDueno(page);
  await page.goto("/p/vapes");
  const tarjeta = page.getByTestId(`vendedor-${VENDEDORA.nombre}`);
  await expect(tarjeta).toContainText("2 ventas · $ 120.000");
  await expect(tarjeta).toContainText("Unitarias1 · $ 20.000");
  await expect(tarjeta).toContainText("Mayoristas1 · $ 100.000");
  // 5 % de 20.000 + 3 % de 100.000.
  await expect(tarjeta).toContainText("Comisión estimada$ 4.000");
  await expect(page.getByTestId("tarjeta-compras")).toBeVisible();

  await irCon(
    page,
    () => tarjeta.getByRole("link", { name: "Ver detalle" }).click(),
    /\/p\/vapes\/equipo\//,
  );
  await expect(page.getByRole("heading", { name: VENDEDORA.nombre })).toBeVisible();
  await expect(page.getByText("2 ventas", { exact: true })).toBeVisible();
  const [descarga] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Exportar Excel/ }).click(),
  ]);
  expect(descarga.suggestedFilename()).toMatch(/^ventas-vendedora-dashboard-.*\.xlsx$/);
});

test("Trinidad ve Mi rendimiento, sin ganancia ni equipo; el export le da 403", async ({
  page,
}) => {
  const t = await trinidad();
  await login(page, "trinidad@negocio.com", PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  await expect(page.getByTestId("tarjeta-mi-rendimiento")).toContainText("Comisión estimada");
  await expect(
    page.getByRole("region", { name: "Indicadores" }).getByTestId("kpi-Facturado"),
  ).toBeVisible();
  await expect(page.getByTestId("kpi-Ganancia")).toHaveCount(0);
  await expect(page.getByTestId("tarjeta-equipo")).toHaveCount(0);
  await expect(page.getByTestId("tarjeta-compras")).toHaveCount(0);
  await expect(page.getByText(/margen/)).toHaveCount(0);

  const r = await page.request.get(`/api/p/vapes/equipo/${t.id}/exportar`);
  expect(r.status()).toBe(403);
  await page.goto(`/p/vapes/equipo/${t.id}`);
  await expect(page).toHaveURL(/sin-acceso/);
});

test('Cosmetic muestra "Unidades vendidas"', async ({ page }) => {
  expect(await db.panel.findUniqueOrThrow({ where: { id: PANEL_COSMETIC } })).toMatchObject({
    etiquetaUnidades: "Unidades vendidas",
  });
  await loginDueno(page);
  await page.goto("/p/cosmetic");
  await expect(page.getByTestId("kpi-Unidades vendidas")).toBeVisible();
  await expect(page.getByTestId("kpi-Vapes vendidos")).toHaveCount(0);
});
