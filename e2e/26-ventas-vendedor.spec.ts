import { Modulo } from "@prisma/client";
import type { Page } from "@playwright/test";

import { formatearPesos } from "../src/lib/format";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  IGNITE_V80,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * "Ventas de Trinidad" (A2, bloque 10): Trinidad vende a un cliente nuevo
 * desde el modal → el cliente queda cargado por ella y atado a esa venta, la
 * venta como "a cliente nuevo" y con ella de vendedora → el dueño entra a
 * Reportes, toca "Ventas de Trinidad" y ve 1 venta, 3 vapes, 1 cliente nuevo,
 * la fila con "Nuevo" y el detalle completo de la venta.
 */
test.describe.configure({ mode: "serial" });

const modal = (page: Page) => page.getByTestId("modal-venta");
const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });
const n = `${Date.now()}`.slice(-6);
const CLIENTE = {
  nombre: `Cliente de Trini ${n}`,
  telefono: `11 7${n.slice(0, 3)} ${n.slice(-4)}`,
};
let codigoVenta = "";

/** Valor (2.º párrafo) de una tarjeta de KPI. */
async function valorKpi(page: Page, label: string) {
  const kpi = page.getByTestId(`kpi-${label}`);
  await expect(kpi).toBeVisible();
  return ((await kpi.locator("p").nth(1).textContent()) ?? "").trim();
}

test("Trinidad vende a un cliente nuevo: queda registrado quién lo cargó y en qué venta", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio (crea datos únicos)");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
  await modal(page)
    .getByRole("radio", { name: /Ayres Plaza/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await soltarFoco(page);
  for (let i = 0; i < 3; i++) await pistola(page, mango);
  await expect(modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("3");
  await continuar(page).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill(CLIENTE.nombre);
  await modal(page).getByLabel("Teléfono").fill(CLIENTE.telefono);
  await continuar(page).click();
  await modal(page).getByRole("radio", { name: "Efectivo" }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  codigoVenta = (await id.textContent())!;

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: codigoVenta },
    include: { cliente: true },
  });
  expect(venta).toMatchObject({ clienteNuevo: true, vendedorId: trinidad.id });
  expect(venta.cliente).toMatchObject({
    nombre: CLIENTE.nombre,
    creadoPorId: trinidad.id,
    creadoEnVentaId: venta.id,
  });
});

test("el dueño ve «Ventas de Trinidad» en Reportes con la venta, los vapes y el cliente nuevo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "depende de la venta del test anterior");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: codigoVenta },
  });
  await loginDueno(page);
  await page.goto("/p/vapes/reportes");
  const card = page.getByTestId(`reporte-vendedor-${trinidad.id}`);
  await expect(card).toContainText("Ventas de Trinidad");
  await expect(card).toContainText("1 venta · 3 vapes vendidos · 1 cliente nuevo");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/p/vapes/equipo/${trinidad.id}\\?`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ventas de Trinidad");
  await expect(page.getByRole("navigation", { name: "Ubicación" })).toContainText("Reportes");

  expect(await valorKpi(page, "Ventas")).toBe("1");
  expect(await valorKpi(page, "Vapes vendidos")).toBe("3");
  expect(await valorKpi(page, "Clientes nuevos")).toBe("1");
  await expect(page.getByTestId("kpi-Clientes nuevos")).toContainText("1 venta a clientes nuevos");
  expect(await valorKpi(page, "Total vendido")).toBe(formatearPesos(venta.total.toString()));
  await expect(page.getByTestId("kpi-Ganancia")).toHaveCount(0);

  const tabla = page.getByRole("table", { name: "Ventas de Trinidad" });
  const fila = tabla.getByRole("row").filter({ hasText: codigoVenta });
  await expect(fila).toContainText(CLIENTE.nombre);
  await expect(fila).toContainText("Nuevo");
  await fila.getByRole("link", { name: codigoVenta }).click();

  await expect(page).toHaveURL(new RegExp(`/p/vapes/ventas/${venta.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(codigoVenta);
  await expect(page.getByText("Cliente nuevo", { exact: true })).toBeVisible();
  await expect(page.getByText(`${IGNITE_V80} — Mango Ice`).first()).toBeVisible();
  await expect(page.getByText("Trinidad").first()).toBeVisible();
});

test("la ruta de Reportes del vendedor lleva a la misma pantalla de Equipo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "una vez alcanza");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await loginDueno(page);
  await page.goto(`/p/vapes/reportes/vendedores/${trinidad.id}?modo=mensual`);
  await expect(page).toHaveURL(
    new RegExp(`/p/vapes/equipo/${trinidad.id}\\?modo=mensual&origen=reportes$`),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ventas de Trinidad");
});

test("Trinidad ve las mismas cifras en «Mi rendimiento», sin ganancia", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "depende de la venta del primer test");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  // "Mi rendimiento" es parte del dashboard: Trinidad necesita DASHBOARD "ver" (como en 20-dashboard).
  await db.permisoUsuario.upsert({
    where: {
      usuarioId_panelId_modulo: {
        usuarioId: trinidad.id,
        panelId: PANEL_VAPES,
        modulo: Modulo.DASHBOARD,
      },
    },
    create: {
      usuarioId: trinidad.id,
      panelId: PANEL_VAPES,
      modulo: Modulo.DASHBOARD,
      puedeVer: true,
    },
    update: { puedeVer: true },
  });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  const mio = page.getByTestId("tarjeta-mi-rendimiento");
  await expect(mio.getByTestId("kpi-Ventas")).toContainText("1");
  await expect(mio.getByTestId("kpi-Vapes vendidos")).toContainText("3");
  await expect(mio.getByTestId("kpi-Clientes nuevos")).toContainText("1 venta a clientes nuevos");
  await expect(page.getByTestId("kpi-Ganancia")).toHaveCount(0);
});
