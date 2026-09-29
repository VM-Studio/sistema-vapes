import { mkdirSync, writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  ELF_BAR_BC5000,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Cotizador: mayorista con escalones por producto, unitaria con PDF y
 * WhatsApp, conversión en venta desde el detalle y permisos de Trinidad.
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/r4";
const sufijo = `${Date.now()}`.slice(-7);
const telefono = `11 6${sufijo.slice(0, 3)} ${sufijo.slice(-4)}`;
let cotizacionUnitaria = "";

async function escalones10_50_100() {
  const p = await db.producto.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombreCompleto: ELF_BAR_BC5000 },
  });
  await db.escalonPrecio.deleteMany({ where: { panelId: PANEL_VAPES, productoId: p.id } });
  await db.escalonPrecio.createMany({
    data: [
      [10, "13500"],
      [50, "12000"],
      [100, "11000"],
    ].map(([cantidadMinima, precioUnitario]) => ({
      panelId: PANEL_VAPES,
      productoId: p.id,
      cantidadMinima: Number(cantidadMinima),
      precioUnitario: String(precioUnitario),
    })),
  });
}

async function agregar(page: Page, sabor: string) {
  await soltarFoco(page);
  await pistola(page, await codigoDe(ELF_BAR_BC5000, sabor));
}

const fila = (page: Page, sabor: string) =>
  page.getByTestId("fila-cotizacion").filter({ hasText: sabor });

test("mayorista: 20 + 35 de dos sabores → escalón 50 en ambas filas y hint al 100", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await escalones10_50_100();
  await loginDueno(page);
  await page.goto("/p/vapes/cotizador/mayorista/nueva");
  await expect(page.getByTestId("modo-escalon")).toContainText("por producto");

  await agregar(page, "Watermelon Ice");
  const cantWater = page.getByLabel(`Cantidad de ${ELF_BAR_BC5000} — Watermelon Ice`);
  await expect(cantWater).toBeFocused();
  await cantWater.fill("20");
  await agregar(page, "Peach Mango");
  await page.getByLabel(`Cantidad de ${ELF_BAR_BC5000} — Peach Mango`).fill("35");

  for (const sabor of ["Watermelon Ice", "Peach Mango"]) {
    await expect(fila(page, sabor).getByTestId("precio-unitario")).toContainText("12.000");
    await expect(fila(page, sabor).getByTestId("precio-lista")).toContainText("14.500");
    await expect(fila(page, sabor).getByTestId("chip-escalon")).toHaveText("Escalón desde 50 u.");
    await expect(fila(page, sabor).getByTestId("hint-escalon")).toContainText(
      "Agregá 45 más y baja a",
    );
    await expect(fila(page, sabor).getByTestId("hint-escalon")).toContainText("11.000");
  }
  await expect(page.getByTestId("total-cotizacion")).toContainText("660.000");
  await expect(page.getByTestId("resumen-escalones").first()).toContainText("55 u.");

  mkdirSync(CARPETA, { recursive: true });
  await page.screenshot({ path: `${CARPETA}/mayorista-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${CARPETA}/mayorista-375.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("codigo-cotizacion")).toHaveText(/^VAP-Q-\d{6}$/);
  const codigo = (await page.getByTestId("codigo-cotizacion").textContent())!;
  const c = await db.cotizacion.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { items: true },
  });
  expect(c.tipo).toBe("MAYORISTA");
  expect(c.estado).toBe("BORRADOR");
  expect(
    c.items.every((i) => i.precioUnitario.toString() === "12000" && i.escalonAplicado === 50),
  ).toBe(true);
  expect(Number(c.total)).toBe(660000);
});

test("unitaria de 3 sabores: PDF y link de WhatsApp", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto("/p/vapes/cotizador/unitaria/nueva");
  for (const sabor of ["Watermelon Ice", "Peach Mango", "Cool Mint"]) await agregar(page, sabor);
  await expect(page.getByTestId("fila-cotizacion")).toHaveCount(3);
  await expect(page.getByTestId("total-cotizacion")).toContainText("43.500");

  await page.getByRole("button", { name: "Agregar cliente" }).click();
  await page.getByRole("button", { name: "Sí", exact: true }).click();
  await page.getByLabel("Nombre").fill("Lucía Cotiza");
  await page.getByLabel("Teléfono").fill(telefono);
  // El selector verifica el teléfono (350 ms) antes de dar el cliente por válido.
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("codigo-cotizacion")).toHaveText(/^VAP-Q-\d{6}$/);
  await expect(page).toHaveURL(/\/cotizador\/[^/]+\/editar$/);
  cotizacionUnitaria = page.url().split("/cotizador/")[1]!.split("/")[0]!;

  await page.goto(`/p/vapes/cotizador/${cotizacionUnitaria}`);
  const wa = await page.getByTestId("whatsapp-cotizacion").getAttribute("href");
  expect(wa).toMatch(/^https:\/\/wa\.me\/54\d{10}\?text=/);
  expect(decodeURIComponent(wa!)).toContain("VAP-Q-");

  const popup = page.waitForEvent("popup").catch(() => null);
  await page.getByRole("button", { name: "PDF" }).click();
  const link = page.getByTestId("pdf-cotizacion");
  await expect(link).toBeVisible({ timeout: 30_000 });
  await (await popup)?.close();
  const r = await page.request.get((await link.getAttribute("href"))!);
  expect(r.ok()).toBe(true);
  expect(r.headers()["content-type"]).toContain("application/pdf");
  const pdf = await r.body();
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(`${CARPETA}/cotizacion-unitaria.pdf`, pdf);
});

test("convertir en venta desde el detalle: ítems y cliente bloqueados, Mercedes + Efectivo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  test.skip(!cotizacionUnitaria, "depende de la cotización unitaria");
  await loginDueno(page);
  await page.goto(`/p/vapes/cotizador/${cotizacionUnitaria}`);
  await page.getByRole("button", { name: "Convertir en venta" }).click();
  const modal = page.getByTestId("modal-venta");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("heading", { name: /Convertir VAP-Q-\d{6} en venta/ }),
  ).toBeVisible();
  await modal.getByRole("radio", { name: /Mercedes/ }).click();
  await modal.getByRole("button", { name: "Continuar con Mercedes" }).click();
  await expect(modal.getByTestId("conversion-bloqueada")).toContainText("y cliente");
  // Sin buscador de productos ni selector de cliente: solo el medio de pago.
  await expect(modal.getByPlaceholder(/Escaneá o buscá/)).toHaveCount(0);
  await expect(modal.getByText("¿Es cliente nuevo?")).toHaveCount(0);
  await expect(modal).toContainText("Lucía Cotiza");
  await modal.getByRole("radio", { name: "Efectivo" }).click();
  await modal.getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal.getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { items: true, deposito: true, cliente: true },
  });
  expect(venta.tipo).toBe("UNITARIA");
  expect(venta.medioPago).toBe("EFECTIVO");
  expect(venta.deposito.nombre).toBe("Mercedes");
  expect(venta.cliente.nombre).toBe("Lucía Cotiza");
  expect(venta.cotizacionId).toBe(cotizacionUnitaria);
  expect(venta.items).toHaveLength(3);
  const c = await db.cotizacion.findUniqueOrThrow({ where: { id: cotizacionUnitaria } });
  expect(c.estado).toBe("CONVERTIDA");
  expect(c.ventaId).toBe(venta.id);
});

test("Trinidad cotiza sin edición de precios ni descuento, y no ve la configuración", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes/cotizador/unitaria/nueva");
  await agregar(page, "Cool Mint");
  await expect(page.getByTestId("fila-cotizacion")).toHaveCount(1);
  await expect(page.getByTestId("precio-unitario")).toContainText("14.500");
  await expect(page.getByLabel("Precio manual (c/u)")).toHaveCount(0);
  await expect(page.getByLabel("Descuento ($)")).toHaveCount(0);

  await page.goto("/p/vapes/cotizador");
  await expect(page.getByRole("link", { name: "Configuración" })).toHaveCount(0);
  await page.goto("/p/vapes/cotizador/configuracion");
  await expect(page).not.toHaveURL(/\/cotizador\/configuracion/);
});
