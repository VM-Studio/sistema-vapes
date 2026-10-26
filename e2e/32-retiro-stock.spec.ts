import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_CHARLY } from "./global-setup";
import {
  codigoDe,
  db,
  depositoId,
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
 * «Retirado» y el stock Disponible / Escaneado / Retirado: una venta de
 * Mercedes con «Escanea Charly» queda pendiente de retiro (no se puede marcar
 * hasta que Charly la escanee); escaneada, suma a «Escaneado» (reservado) y
 * Charly la marca «Retirado» desde su pantalla; pasa a «Retirado». Una venta
 * de Ayres Plaza se retira desde la lista de ventas. Los filtros de stock
 * (gusto, modelo, pitadas, tarjetas) se combinan y los movimientos muestran
 * «Venta VAP-… a …» y el retiro, también desde Productos y la ficha.
 */
test.describe.configure({ mode: "serial" });

const modal = (page: Page) => page.getByTestId("modal-venta");
const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });
const telefono = () => `11 5${`${Date.now()}`.slice(-7)}`;

async function vender(
  page: Page,
  galpon: string,
  codigos: string[],
  cliente: string,
  escaneaCharly = false,
): Promise<string> {
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
  await modal(page)
    .getByRole("radio", { name: new RegExp(galpon) })
    .click();
  await modal(page)
    .getByRole("button", { name: `Continuar con ${galpon}` })
    .click();
  await soltarFoco(page);
  for (const c of codigos) await pistola(page, c);
  await continuar(page).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill(cliente);
  await modal(page).getByLabel("Teléfono").fill(telefono());
  await continuar(page).click();
  await modal(page).getByRole("radio", { name: "Efectivo" }).click();
  if (escaneaCharly) await modal(page).getByRole("switch", { name: "Escanea Charly" }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  return (await id.textContent())!;
}

async function celularCharly(browser: Browser, baseURL: string | undefined) {
  const contexto = await browser.newContext({
    baseURL,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  });
  const page = await contexto.newPage();
  await login(page, "charly@negocio.com", PASSWORD_CHARLY);
  return { contexto, page };
}

const tarjeta = (page: Page, nombre: string) =>
  page.getByTestId("tarjetas-stock").getByRole("link", { name: new RegExp(nombre) });

test("Mercedes + Charly: pendiente → escaneado (reservado) → «Retirado»; Ayres: retirado desde la lista", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio + celular de Charly");
  test.setTimeout(150_000);
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const blue = await codigoDe(IGNITE_V80, "Blue Razz Ice");
  const mercedes = await depositoId("Mercedes");
  await loginDueno(page);

  const codigo = await vender(page, "Mercedes", [mango, mango], "Cliente Retiro", true);
  const venta = await db.venta.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigo } });
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  const retiro = page.getByTestId("retiro-venta");
  await expect(retiro).toContainText("Pendiente de retiro");
  await expect(retiro).toContainText("Falta que Charly la escanee");
  await expect(retiro.getByRole("button", { name: /Retirado/ })).toHaveCount(0);

  // Stock de Mercedes, Mango Ice: todavía no es «escaneado».
  const stockMango = `/p/vapes/stock?tab=${mercedes}&q=${encodeURIComponent("V80 Mango Ice")}`;
  await page.goto(stockMango);
  const tabla = page.getByTestId("tabla-stock");
  for (const col of ["Disponible", "Escaneado", "Retirado"])
    await expect(tabla.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
  await expect(page.getByTestId("fisico-stock")).toContainText(
    "Vendidas sin retirar (sin escanear): 2",
  );

  // Charly escanea: la venta pasa a «Listas para retirar».
  const { contexto, page: cel } = await celularCharly(browser, baseURL);
  await cel.getByTestId("venta-para-escanear").filter({ hasText: codigo }).click();
  await soltarFoco(cel);
  await pistola(cel, mango);
  await pistola(cel, mango);
  await cel.getByRole("button", { name: "Vape escaneado" }).click();
  const paraRetirar = cel.getByTestId("venta-para-retirar").filter({ hasText: codigo });
  await expect(paraRetirar).toBeVisible();

  // Dueño: «Escaneado» = reservado; la tarjeta filtra la lista.
  await page.goto(stockMango);
  await expect(tarjeta(page, "Escaneado")).toContainText("2");
  await tarjeta(page, "Escaneado").click();
  await expect(page).toHaveURL(/ver=escaneado/);
  const fila = tabla.getByRole("row", { name: /Mango Ice/ });
  await expect(fila).toHaveCount(1);
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(retiro.getByRole("button", { name: /Retirado/ })).toBeVisible();

  // Charly la entrega: «Retirado».
  await paraRetirar.getByRole("button", { name: /Retirado/ }).click();
  await expect(cel.getByTestId("venta-para-retirar").filter({ hasText: codigo })).toHaveCount(0);
  await contexto.close();
  const retirada = await db.venta.findUniqueOrThrow({ where: { id: venta.id } });
  expect(retirada.retiradaAt).not.toBeNull();

  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByTestId("badge-retiro")).toContainText("Retirada el");
  await page.goto(`${stockMango}&ver=retirado`);
  await expect(tabla.getByRole("row", { name: /Mango Ice/ })).toHaveCount(1);
  await page.goto(`${stockMango}&ver=escaneado`);
  await expect(page.getByText("No hay sabores con esos filtros")).toBeVisible();

  // Ayres Plaza (sin escaneo): «Retirado» desde la lista de pendientes.
  const otro = await vender(page, "Ayres Plaza", [blue], "Cliente Ayres Retiro");
  await page.goto("/p/vapes/ventas?retiro=pendiente");
  const filaVenta = page.getByRole("row").filter({ hasText: otro });
  await expect(filaVenta.getByTestId("badge-retiro")).toHaveText("Pendiente de retiro");
  await filaVenta.getByRole("button", { name: `Retirado (venta ${otro})` }).click();
  await expect(page.getByRole("row").filter({ hasText: otro })).toHaveCount(0);
  await page.goto("/p/vapes/ventas?retiro=retirada&rango=todo");
  await expect(
    page.getByRole("row").filter({ hasText: otro }).getByTestId("badge-retiro"),
  ).toContainText("Retirada el");

  // Movimientos: texto fácil y el retiro (desde Productos también).
  await page.goto("/p/vapes/productos/movimientos?familia=ventas");
  const movs = page.getByRole("table", { name: "Movimientos de stock" });
  await expect(movs.getByText(`Venta ${codigo} a Cliente Retiro`).first()).toBeVisible();
  await expect(movs.getByText(`Retirado (venta ${codigo} a Cliente Retiro)`).first()).toBeVisible();
  await expect(movs.getByRole("link", { name: codigo }).first()).toHaveAttribute(
    "href",
    `/p/vapes/ventas/${venta.id}`,
  );

  // Ficha del producto: solo sus movimientos, filtrables por sabor.
  const item = await db.ventaItem.findFirstOrThrow({ where: { ventaId: venta.id } });
  await page.goto(`/p/vapes/productos/${item.productoId}?msabor=${item.varianteId}`);
  const movsProducto = page.getByRole("table", { name: "Movimientos de stock" });
  await expect(movsProducto.getByText(`Venta ${codigo} a Cliente Retiro`).first()).toBeVisible();
  await expect(movsProducto.getByText(`Venta ${otro}`, { exact: false })).toHaveCount(0);
});

test("stock: gusto, modelo y pitadas se combinan con la marca y quedan en la URL", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "tabla de escritorio");
  await loginDueno(page);
  await page.goto("/p/vapes/stock?tab=global");
  const tabla = page.getByTestId("tabla-stock");
  const filas = tabla.locator("tbody tr");
  await expect(filas.first()).toBeVisible();
  const todas = await filas.count();

  // Pitadas: solo los de 8000 (Ignite V80, con todos sus gustos).
  await page.getByLabel("Pitadas", { exact: true }).selectOption({ label: "8000" });
  await expect(page).toHaveURL(/pitadas=8000/);
  await expect.poll(() => filas.count()).toBeLessThan(todas);
  await page.waitForLoadState("networkidle");
  for (const t of await filas.allTextContents()) expect(t).toContain(IGNITE_V80);

  // + gusto: combinados.
  await page.getByLabel("Gusto", { exact: true }).selectOption({ label: "Mango Ice" });
  await expect(page).toHaveURL(/gusto=mango(\+|%20)ice/);
  await expect(page).toHaveURL(/pitadas=8000/);
  await expect(filas).toHaveCount(1);
  await expect(filas.first()).toContainText(`${IGNITE_V80} — Mango Ice`);
  await page.waitForLoadState("networkidle");

  // + marca y modelo (la lista de modelos es la de la marca).
  await page.getByLabel("Marca", { exact: true }).selectOption({ label: "Ignite" });
  await expect(page).toHaveURL(/marcaId=/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Modelo", { exact: true }).locator("option")).toHaveText([
    "Todos los modelos",
    "V80",
  ]);
  await page.getByLabel("Modelo", { exact: true }).selectOption({ label: "V80" });
  await expect(page).toHaveURL(/modelo=v80/);
  await expect(filas).toHaveCount(1);
  // Todo queda en la URL: recargar mantiene los filtros.
  await page.reload();
  await expect(page.getByLabel("Gusto", { exact: true })).toHaveValue("mango ice");
  await expect(filas).toHaveCount(1);
});
