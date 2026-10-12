import { mkdirSync, writeFileSync } from "node:fs";

import { request, type Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  ELF_BAR_BC10000,
  ELF_BAR_BC5000,
  esperarPdf,
  IGNITE_V80,
  linkPublicoPdf,
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
      moneda: "ARS" as const,
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
      "Agregá 45 más del producto y baja a",
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

/** Escalones propios EN DÓLARES (blue venta del setup: $1.300). */
async function escalonesUSD(producto: string, filas: [number, string][]) {
  const p = await db.producto.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombreCompleto: producto },
  });
  await db.escalonPrecio.deleteMany({ where: { panelId: PANEL_VAPES, productoId: p.id } });
  await db.escalonPrecio.createMany({
    data: filas.map(([cantidadMinima, precioUnitario]) => ({
      panelId: PANEL_VAPES,
      productoId: p.id,
      cantidadMinima,
      precioUnitario,
      moneda: "USD" as const,
    })),
  });
  return p.id;
}

test("mayorista en dólares: escalón por modelo (30 + 30 de dos productos no suman), 20 + 35 del mismo sí; USD y pesos con snapshot del blue", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const ignite = await escalonesUSD(IGNITE_V80, [
    [10, "9"],
    [50, "7"],
  ]);
  const elf10 = await escalonesUSD(ELF_BAR_BC10000, [[50, "8"]]);
  const agregarDe = async (producto: string, sabor: string) => {
    await soltarFoco(page);
    await pistola(page, await codigoDe(producto, sabor));
  };
  const filaDe = (producto: string, sabor: string) =>
    page.getByTestId("fila-cotizacion").filter({ hasText: `${producto} — ${sabor}` });

  await loginDueno(page);
  await page.goto("/p/vapes/cotizador/mayorista/nueva");
  await expect(page.getByTestId("blue-cotizador")).toContainText("Dólar blue venta: $ 1.300");

  // Dos productos distintos de 30 u. cada uno: 60 en la cotización, ninguno al escalón 50.
  await agregarDe(IGNITE_V80, "Mango Ice");
  await page.getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`).fill("30");
  await agregarDe(ELF_BAR_BC10000, "Watermelon Ice");
  await page.getByLabel(`Cantidad de ${ELF_BAR_BC10000} — Watermelon Ice`).fill("30");
  const mango = filaDe(IGNITE_V80, "Mango Ice");
  const water = filaDe(ELF_BAR_BC10000, "Watermelon Ice");
  await expect(mango.getByTestId("chip-escalon")).toHaveText("Escalón desde 10 u.");
  await expect(mango.getByTestId("precio-unitario-usd")).toHaveText("U$D 9 c/u");
  await expect(mango.getByTestId("precio-unitario")).toContainText("11.700");
  await expect(water.getByTestId("chip-escalon")).toHaveCount(0);
  await expect(water.getByTestId("precio-unitario")).toContainText("19.000");
  await expect(water.getByTestId("hint-escalon")).toContainText("Agregá 20 más del producto");
  const resumen = page.getByTestId("resumen-escalones").first();
  await expect(resumen).toContainText("30 u. · escalón 10+");
  await expect(resumen).toContainText("30 u. · precio de lista");
  mkdirSync("verificacion/a2", { recursive: true });
  await page.screenshot({ path: "verificacion/a2/bloque5-30-30-1440.png", fullPage: true });

  // El mismo producto con 20 Mango + 35 Strawberry: los dos sabores al escalón 50.
  await page.getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`).fill("20");
  await agregarDe(IGNITE_V80, "Strawberry Watermelon");
  await page.getByLabel(`Cantidad de ${IGNITE_V80} — Strawberry Watermelon`).fill("35");
  for (const sabor of ["Mango Ice", "Strawberry Watermelon"]) {
    const f = filaDe(IGNITE_V80, sabor);
    await expect(f.getByTestId("chip-escalon")).toHaveText("Escalón desde 50 u.");
    await expect(f.getByTestId("precio-unitario-usd")).toHaveText("U$D 7 c/u");
    await expect(f.getByTestId("precio-unitario")).toContainText("9.100");
  }
  await expect(resumen).toContainText("55 u. · escalón 50+");
  // 55 × $9.100 + 30 × $19.000 = $1.070.500 · U$D 385 + 570.000 / 1.300 ≈ U$D 823,46
  await expect(page.getByTestId("total-cotizacion")).toContainText("1.070.500");
  await expect(page.getByTestId("total-cotizacion-usd")).toContainText("U$D 823,46");
  await page.screenshot({ path: "verificacion/a2/bloque5-20-35-1440.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "verificacion/a2/bloque5-20-35-375.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("codigo-cotizacion")).toHaveText(/^VAP-Q-\d{6}$/);
  const codigo = (await page.getByTestId("codigo-cotizacion").textContent())!;
  const c = await db.cotizacion.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { items: true },
  });
  expect(c.tipoCambioBlue?.toString()).toBe("1300");
  expect(c.tipoCambioObtenidoAt).not.toBeNull();
  const delIgnite = c.items.filter((i) => i.productoId === ignite);
  expect(delIgnite).toHaveLength(2);
  expect(delIgnite.every((i) => i.precioUnitarioUSD?.toString() === "7")).toBe(true);
  expect(delIgnite.every((i) => i.precioUnitario.toString() === "9100")).toBe(true);
  expect(c.items.find((i) => i.productoId === elf10)!.precioUnitarioUSD).toBeNull();

  // Detalle, WhatsApp y PDF con dólares y pesos y el blue usado.
  await page.goto(`/p/vapes/cotizador/${c.id}`);
  await expect(page.getByTestId("blue-cotizacion")).toContainText("$ 1.300");
  await expect(page.getByTestId("total-usd")).toContainText("U$D 823,46");
  const wa = decodeURIComponent(
    (await page.getByTestId("whatsapp-cotizacion").getAttribute("href"))!,
  ).replace(/\s/g, " ");
  expect(wa).toContain("U$D 7 · $ 9.100");
  expect(wa).toContain("Precios en dólares convertidos a blue venta $ 1.300 del");
  const pdf = await esperarPdf(page.request, `/api/p/vapes/cotizaciones/${c.id}/pdf`);
  writeFileSync("verificacion/a2/bloque5-cotizacion-mayorista.pdf", pdf);
  await page.screenshot({ path: "verificacion/a2/bloque5-detalle-1440.png", fullPage: true });

  await db.escalonPrecio.deleteMany({ where: { productoId: { in: [ignite, elf10] } } });
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

  // El botón PDF es un link a la ruta que genera el PDF, en una pestaña nueva.
  const link = page.getByTestId("pdf-cotizacion");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", `/api/p/vapes/cotizaciones/${cotizacionUnitaria}/pdf`);
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toContain(`/api/p/vapes/cotizaciones/${cotizacionUnitaria}/pdf`);
  await popup.close();
  const pdf = await esperarPdf(page.request, (await link.getAttribute("href"))!);
  // Segunda vez: del caché del storage, mismo PDF.
  expect((await esperarPdf(page.request, (await link.getAttribute("href"))!)).equals(pdf)).toBe(
    true,
  );
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(`${CARPETA}/cotizacion-unitaria.pdf`, pdf);

  // El link del PDF que va en el WhatsApp abre sin sesión (firmado); con otra firma, 404.
  const publico = linkPublicoPdf(decodeURIComponent(wa!));
  expect(publico).toMatch(/^\/api\/publico\/pdf\/cotizacion\//);
  const anonimo = await request.newContext({ baseURL: new URL(page.url()).origin });
  await esperarPdf(anonimo, publico);
  expect((await anonimo.get(publico.replace(/[^/]+$/, "x".repeat(32)))).status()).toBe(404);
  expect((await anonimo.get(`/api/p/vapes/cotizaciones/${cotizacionUnitaria}/pdf`)).status()).toBe(
    401,
  );
  await anonimo.dispose();
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
  await expect(page.getByLabel(/Precio manual/)).toHaveCount(0);
  await expect(page.getByLabel("Descuento ($)")).toHaveCount(0);

  await page.goto("/p/vapes/cotizador");
  await expect(page.getByRole("link", { name: "Configuración" })).toHaveCount(0);
  await page.goto("/p/vapes/cotizador/configuracion");
  await expect(page).not.toHaveURL(/\/cotizador\/configuracion/);
});
