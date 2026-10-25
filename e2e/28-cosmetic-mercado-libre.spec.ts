import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { db, llamarAccion, loginDueno, PANEL_COSMETIC, pistola, soltarFoco } from "./helpers";

/**
 * Cosmetic cobra por Mercado Libre: sus medios son Efectivo, Transferencia y
 * Mercado Libre (sin Binance); un producto con precio de lista $ 12.000
 * vendido por ML lleva el precio cargado a mano en la venta ($ 15.000,
 * origenPrecio ML), y esa venta se factura (factura B con su PDF).
 */
test.describe.configure({ mode: "serial" });

const sufijo = () => `${Date.now()}`.slice(-5) + `${Math.floor(Math.random() * 900) + 100}`;
const modal = (page: Page) => page.getByTestId("modal-venta");

export async function productoCosmetic(page: Page) {
  const codigoBarras = `98${sufijo()}${sufijo().slice(0, 3)}`;
  const modelo = `Serum ML ${codigoBarras.slice(-5)}`;
  await page.goto("/p/cosmetic/productos");
  const alta = await llamarAccion(
    page,
    "altaRapidaAction",
    {
      codigoBarras,
      marca: "Marca ML",
      modelo,
      especificacion: "30 ml",
      sabor: "",
      precioVenta: "12000",
    },
    "/p/cosmetic/productos",
  );
  expect(alta).toContain('"ok":true');
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigoBarras },
  });
  const carga = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { depositoId: "dep_cosmetic_principal", items: [{ varianteId: variante.id, cantidad: 5 }] },
    "/p/cosmetic/productos/cargar",
  );
  expect(carga).toContain('"ok":true');
  return { codigoBarras, modelo, variante };
}

test("Cosmetic: venta por ML con el precio cargado a mano ($ 15.000)", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  const { codigoBarras, variante } = await productoCosmetic(page);

  // El producto ya no pide precio Mercado Libre: se carga en cada venta.
  await page.goto(`/p/cosmetic/productos/${variante.productoId}/editar`);
  await expect(page.getByLabel("Precio de venta")).toBeVisible();
  await expect(page.getByLabel("Precio Mercado Libre")).toHaveCount(0);

  // Venta: el paso 4 ofrece Efectivo / Transferencia / Mercado Libre (sin Binance).
  await page.goto("/p/cosmetic/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
  await modal(page)
    .getByRole("radio", { name: /Principal/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Principal" }).click();
  await soltarFoco(page);
  await pistola(page, codigoBarras);
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill("Clienta ML");
  await modal(page)
    .getByLabel("Teléfono")
    .fill(`11 6${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`);
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();

  const medios = modal(page).getByRole("radiogroup", { name: "Medio de pago" });
  await expect(medios.getByRole("radio")).toHaveText([
    "Efectivo",
    "Transferencia",
    "Mercado Libre",
    "Fiado",
  ]);
  await expect(medios.getByRole("radio", { name: "Binance" })).toHaveCount(0);
  await expect(modal(page).getByTestId("total-venta")).toHaveText("$ 12.000");

  await medios.getByRole("radio", { name: "Mercado Libre" }).click();
  await expect(modal(page).getByTestId("precios-ml")).toContainText("Precios Mercado Libre");
  await expect(modal(page).getByTestId("faltan-precios-ml")).toBeVisible();
  await expect(modal(page).getByRole("button", { name: "Confirmar venta" })).toBeDisabled();
  await modal(page)
    .getByRole("textbox", { name: /^Precio Mercado Libre de / })
    .fill("15000");
  await expect(modal(page).getByTestId("faltan-precios-ml")).toHaveCount(0);
  await expect(modal(page).getByTestId("total-venta")).toHaveText("$ 15.000");
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^COS-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigo },
    include: { items: true },
  });
  expect(venta.medioPago).toBe("MERCADO_LIBRE");
  expect(venta.total.toFixed(2)).toBe("15000.00");
  expect(venta.items[0]!.precioLista.toFixed(2)).toBe("15000.00");
  expect(venta.items[0]!.precioUnitario.toFixed(2)).toBe("15000.00");
  expect(venta.items[0]!.origenPrecio).toBe("ML");

  // Detalle de la venta → «Facturar» → factura B con el total de la venta → PDF.
  await page.goto(`/p/cosmetic/ventas/${venta.id}`);
  await expect(page.getByTestId("origen-ml")).toBeVisible();
  await page.getByRole("link", { name: "Facturar" }).click();
  await expect(page.getByTestId("venta-a-facturar")).toContainText(codigo);
  await expect(page.getByLabel("Tipo")).toHaveValue("B");
  await expect(page.getByTestId("total-factura")).toHaveText("$ 15.000");
  await page.getByRole("button", { name: "Registrar factura" }).click();
  await page.waitForURL(/\/facturas\/(?!nueva)[^/]+$/);
  await expect(page.getByRole("heading", { name: /^Factura B COS-F-\d{6}$/ })).toBeVisible();
  await expect(page.getByTestId("total-factura")).toHaveText("$ 15.000");
  const factura = await db.factura.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, ventaId: venta.id, estado: "EMITIDA" },
  });
  expect(factura.tipo).toBe("B");
  expect(factura.total.toFixed(2)).toBe("15000.00");
  const pdf = await page.request.get(`/api/p/cosmetic/facturas/${factura.id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const excel = await page.request.get("/api/p/cosmetic/facturas/exportar");
  expect(excel.status()).toBe(200);
  expect(excel.headers()["content-type"]).toContain("spreadsheetml");
  // La venta ahora enlaza su factura y el listado la muestra.
  await page.goto(`/p/cosmetic/ventas/${venta.id}`);
  await expect(page.getByTestId("link-factura")).toContainText(factura.codigo);
  await page.goto("/p/cosmetic/facturas");
  await expect(page.getByRole("link", { name: factura.codigo }).first()).toBeVisible();

  // El reporte "Ventas Mercado Libre".
  await page.goto("/p/cosmetic/reportes");
  await page.getByTestId("reporte-mercado-libre").click();
  await expect(page.getByRole("heading", { name: "Ventas Mercado Libre" })).toBeVisible();
  await expect(page.getByText("$ 15.000").first()).toBeVisible();
});

test("Vapes no cobra por Mercado Libre ni factura: sin precio ML, reporte ni Facturas", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto("/p/vapes/productos/nuevo");
  await expect(page.getByLabel("Precio de venta")).toBeVisible();
  await expect(page.getByLabel("Precio Mercado Libre")).toHaveCount(0);
  await page.goto("/p/vapes/reportes");
  await expect(page.getByTestId("reporte-mercado-libre")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Facturas", exact: true })).toHaveCount(0);
});

test("medios de pago del panel: se editan en Ajustes → Ventas", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto("/p/cosmetic/configuracion/ventas");
  const lista = page.getByTestId("medios-pago");
  await expect(lista.getByRole("checkbox", { name: "Mercado Libre" })).toBeChecked();
  await expect(lista.getByRole("checkbox", { name: "Binance" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: /precio Mercado Libre/ })).toHaveCount(0);
  await expect(page.getByTestId("aviso-precio-ml")).toContainText("se carga a mano");
});
