import { mkdirSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { db, llamarAccion, loginDueno, PANEL_COSMETIC, pistola, soltarFoco } from "./helpers";

/**
 * Cosmetic: una venta cobrada por Mercado Libre lleva el precio de cada
 * producto cargado a mano y aparece sola en Facturas → «Ventas Mercado Libre»
 * como pendiente; «Cargar» (fecha de hoy + archivo opcional) → «Cargado» la
 * pasa a cargada y las tarjetas de totales cambian.
 */
test.describe.configure({ mode: "serial" });

const CAPTURAS = "verificacion/a3";
const sufijo = () => `${Date.now()}`.slice(-5) + `${Math.floor(Math.random() * 900) + 100}`;
const modal = (page: Page) => page.getByTestId("modal-venta");
/** PDF mínimo válido (la app detecta el tipo por el contenido). */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function productoConStock(page: Page) {
  const codigoBarras = `97${sufijo()}${sufijo().slice(0, 3)}`;
  await page.goto("/p/cosmetic/productos");
  const alta = await llamarAccion(
    page,
    "altaRapidaAction",
    {
      codigoBarras,
      marca: "Marca FML",
      modelo: `Tónico ${codigoBarras.slice(-5)}`,
      especificacion: "200 ml",
      sabor: "",
      precioVenta: "10000",
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
    { depositoId: "dep_cosmetic_principal", items: [{ varianteId: variante.id, cantidad: 6 }] },
    "/p/cosmetic/productos/cargar",
  );
  expect(carga).toContain('"ok":true');
  return { codigoBarras, variante };
}

/** Lo que tienen que mostrar las tarjetas (ventas ML confirmadas, cargadas y pendientes). */
async function totalesEnDb() {
  const base = {
    panelId: PANEL_COSMETIC,
    medioPago: "MERCADO_LIBRE",
    estado: "CONFIRMADA",
  } as const;
  const [cargadas, pendientes] = await Promise.all([
    db.venta.count({ where: { ...base, facturaML: { isNot: null } } }),
    db.venta.count({ where: { ...base, facturaML: { is: null } } }),
  ]);
  return { cargadas, pendientes };
}
const ventas = (n: number) => `${n} ${n === 1 ? "venta" : "ventas"}`;

test("venta ML con precio a mano → pendiente en Facturas → «Cargar» con archivo → cargada", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  mkdirSync(CAPTURAS, { recursive: true });
  await loginDueno(page);
  const { codigoBarras } = await productoConStock(page);

  // Venta: 2 unidades, cobrada por Mercado Libre a $ 18.500 c/u (cargado a mano).
  await page.goto("/p/cosmetic/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await modal(page)
    .getByRole("radio", { name: /Principal/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Principal" }).click();
  await soltarFoco(page);
  await pistola(page, codigoBarras);
  await pistola(page, codigoBarras);
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill("Clienta Factura ML");
  await modal(page)
    .getByLabel("Teléfono")
    .fill(`11 6${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`);
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page)
    .getByRole("radiogroup", { name: "Medio de pago" })
    .getByRole("radio", { name: "Mercado Libre" })
    .click();
  const confirmar = modal(page).getByRole("button", { name: "Confirmar venta" });
  await expect(confirmar).toBeDisabled();
  await expect(modal(page).getByTestId("faltan-precios-ml")).toHaveText(
    "Falta el precio de 1 producto.",
  );
  const precio = modal(page).getByRole("textbox", { name: /^Precio Mercado Libre de / });
  await precio.fill("0");
  await expect(confirmar).toBeDisabled();
  await precio.fill("18.500");
  await expect(modal(page).getByTestId("total-ml")).toContainText("$ 37.000");
  await expect(modal(page).getByTestId("total-venta")).toHaveText("$ 37.000");
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-precio-manual-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(precio).toBeVisible();
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-precio-manual-375.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await confirmar.click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^COS-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigo },
    include: { items: true },
  });
  expect(venta.medioPago).toBe("MERCADO_LIBRE");
  expect(venta.total.toFixed(2)).toBe("37000.00");
  expect(venta.items[0]!.precioUnitario.toFixed(2)).toBe("18500.00");
  expect(venta.items[0]!.origenPrecio).toBe("ML");

  // Facturas → Ventas Mercado Libre: aparece sola, pendiente.
  const antes = await totalesEnDb();
  await page.goto("/p/cosmetic/facturas");
  await page.getByRole("link", { name: /^Ventas Mercado Libre/ }).click();
  await page.waitForURL(/\/facturas\/mercado-libre$/);
  await expect(page.getByTestId("tarjeta-ml-pendientes")).toContainText(ventas(antes.pendientes));
  await expect(page.getByTestId("tarjeta-ml-cargadas")).toContainText(ventas(antes.cargadas));
  const fila = page.getByRole("row").filter({ hasText: codigo });
  await expect(fila.getByTestId("estado-factura-ml")).toHaveText("Pendiente");
  await expect(fila).toContainText("$ 37.000");
  await page.screenshot({
    path: `${CAPTURAS}/bloqueML-facturas-pendiente-1440.png`,
    fullPage: true,
  });

  // «Cargar»: fecha de hoy precargada + archivo → «Cargado».
  await fila.getByRole("button", { name: "Cargar" }).click();
  const dialogo = page.getByRole("dialog", { name: `Cargar factura de ${codigo}` });
  await expect(dialogo).toBeVisible();
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
  await expect(dialogo.getByLabel("Fecha de la factura")).toHaveValue(hoy);
  await dialogo.getByLabel("Archivo de la factura (opcional)").setInputFiles({
    name: "factura-arca.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await dialogo.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-cargar-1440.png` });
  await dialogo.getByRole("button", { name: "Cargado" }).click();
  await expect(dialogo).toBeHidden();
  await expect(fila.getByTestId("estado-factura-ml")).toHaveText("Cargada");
  await expect(page.getByTestId("tarjeta-ml-pendientes")).toContainText(
    ventas(antes.pendientes - 1),
  );
  await expect(page.getByTestId("tarjeta-ml-cargadas")).toContainText(ventas(antes.cargadas + 1));
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-facturas-cargada-1440.png`, fullPage: true });

  const carga = await db.facturaMercadoLibre.findUniqueOrThrow({ where: { ventaId: venta.id } });
  expect(carga.archivoTipo).toBe("application/pdf");
  expect(carga.archivoNombre).toBe("factura-arca.pdf");
  // Ver / descargar el archivo cargado.
  const href = await fila.getByTestId("ver-archivo-ml").getAttribute("href");
  const archivo = await page.request.get(href!);
  expect(archivo.status()).toBe(200);
  expect(archivo.headers()["content-type"]).toBe("application/pdf");
  expect((await archivo.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const descarga = await page.request.get(`${href}?descargar=1`);
  expect(descarga.headers()["content-disposition"]).toContain("attachment");

  // Detalle de la venta desde la fila.
  await fila.getByRole("button", { name: "Detalle" }).click();
  const detalle = page.getByRole("dialog", { name: `Venta ${codigo}` });
  await expect(detalle).toContainText("2 ×");
  await expect(detalle.getByTestId("detalle-factura-ml")).toContainText("Factura cargada");
  await detalle.getByRole("button", { name: "Cerrar" }).click();
  await expect(detalle).toBeHidden();

  // Filtro por estado: pendientes no la muestra; cargadas sí.
  // (El select es controlado por la URL: si un refresh en curso lo pisa, se reintenta.)
  await expect(async () => {
    await page.getByLabel("Estado de la factura").selectOption("PENDIENTE");
    await expect(page).toHaveURL(/estado=PENDIENTE/, { timeout: 3_000 });
  }).toPass();
  await expect(page.getByRole("row").filter({ hasText: codigo })).toHaveCount(0);
  await expect(page.getByLabel("Estado de la factura")).toHaveValue("PENDIENTE");
  await page.goto("/p/cosmetic/facturas/mercado-libre?estado=CARGADA");
  await expect(page.getByRole("row").filter({ hasText: codigo })).toHaveCount(1);

  // Auditoría de la carga.
  const audit = await db.auditLog.findFirst({
    where: { entidad: "FacturaMercadoLibre", entidadId: carga.id },
  });
  expect(audit).not.toBeNull();
});

test("Ventas Mercado Libre en el celular (375): listado y «Cargar»", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "solo celular");
  mkdirSync(CAPTURAS, { recursive: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await loginDueno(page);
  const { variante } = await productoConStock(page);
  const r = await llamarAccion(
    page,
    "generarVentaAction",
    {
      depositoId: "dep_cosmetic_principal",
      cliente: { nuevo: { nombre: "Clienta ML Celular", telefono: `11 7${sufijo().slice(0, 7)}` } },
      items: [{ varianteId: variante.id, cantidad: 1, precioML: 21000 }],
      pagos: [{ medioPago: "MERCADO_LIBRE", monto: 21000 }],
    },
    "/p/cosmetic/ventas",
  );
  expect(r).toContain('"ok":true');
  const codigo = /"codigo":"(COS-\d{6})"/.exec(r)![1]!;

  await page.goto("/p/cosmetic/facturas/mercado-libre");
  const tarjeta = page.getByTestId("tarjeta-venta-ml").filter({ hasText: codigo });
  await expect(tarjeta.getByTestId("estado-factura-ml")).toHaveText("Pendiente");
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-facturas-375.png`, fullPage: true });
  await tarjeta.getByRole("button", { name: "Cargar" }).click();
  const dialogo = page.getByRole("dialog", { name: `Cargar factura de ${codigo}` });
  await expect(dialogo).toBeVisible();
  await dialogo.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-cargar-375.png` });
  // Sin archivo: queda cargada igual.
  await dialogo.getByRole("button", { name: "Cargado" }).click();
  await expect(dialogo).toBeHidden();
  await expect(tarjeta.getByTestId("estado-factura-ml")).toHaveText("Cargada");
  await page.screenshot({ path: `${CAPTURAS}/bloqueML-facturas-cargada-375.png`, fullPage: true });
});
