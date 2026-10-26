import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./base";

import {
  db,
  EMAIL_DUENO,
  esMobile,
  login,
  loginDueno,
  PANEL_COSMETIC,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { PASSWORD_TRINIDAD } from "./global-setup";
import { limpiarAlTerminar } from "./fixtures";

limpiarAlTerminar();

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}

/** Un vape (un sabor) y un proveedor que lo vende a $ 10.000 en pesos. */
async function preparar(sufijo: string) {
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `Pas${sufijo}` } });
  const codigo = ean13(`779${sufijo}001`);
  const producto = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Pod",
      especificacion: "9000",
      precioVenta: 18000,
      variantes: {
        create: {
          panelId: PANEL_VAPES,
          nombre: "Mango",
          sku: `E2E-P${sufijo}`,
          codigoBarras: codigo,
        },
      },
    },
    include: { variantes: true },
  });
  const proveedor = await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Pasista",
      nombreTienda: `Galpón ${sufijo}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: producto.id,
          precio: 10000,
          moneda: "ARS",
          usuarioId: dueno.id,
        },
      },
    },
  });
  return { producto, proveedor, codigo, mango: producto.variantes[0]! };
}

test("compra de 100 u. × $10.000 con 10% de pasista + Valija y Envío → $11.800 por unidad, y se paga en Pasista", async ({
  page,
}) => {
  test.skip(esMobile(page), "El flujo completo se prueba en escritorio; en mobile, la navegación.");
  const sufijo = String(Date.now()).slice(-6);
  const { producto, proveedor, codigo, mango } = await preparar(sufijo);
  const nc = `${producto.nombreCompleto} — Mango`;

  await loginDueno(page);
  await page.goto("/p/vapes/compras/nueva");
  await page.getByRole("radio", { name: new RegExp(`Galpón ${sufijo}`) }).click();
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();
  await expect(page.getByText("Paso 3 de 3", { exact: false })).toBeVisible();
  await soltarFoco(page);
  await pistola(page, codigo);
  await expect(page.getByLabel(`Costo de ${nc}`)).toHaveValue("10000");
  await page.getByLabel(`Cantidad de ${nc}`).fill("100");

  // Tick de la comisión del pasista (10% por defecto) → resumen en vivo.
  await page.getByRole("checkbox", { name: /Comisión del/ }).check();
  await expect(page.getByLabel("Porcentaje de comisión del pasista")).toHaveValue("10");
  await expect(page.getByLabel("Comisión del pasista", { exact: true })).toHaveText(
    /\$\s*100\.000/,
  );
  await expect(page.getByLabel("Costo final total", { exact: true })).toHaveText(
    /\$\s*1\.100\.000/,
  );
  await expect(page.getByLabel(`Costo final por unidad de ${nc}`)).toHaveText(/\$\s*11\.000/);
  await expect(page.getByTestId("cotizacion-resumen")).toBeVisible();

  // Confirmar (queda pendiente de recibir) y después «Recibido» en el detalle.
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/p\/vapes\/compras\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nueva"),
  );
  await page.getByRole("button", { name: /^Recibido/ }).click();
  const dialogo = page.getByRole("dialog", { name: "¿Llegó la mercadería?" });
  await dialogo.getByRole("button", { name: "Recibido", exact: true }).click();
  await expect(page.getByText("Recibida", { exact: true })).toBeVisible();

  const compra = await db.compra.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, proveedorId: proveedor.id },
  });
  expect(compra.comisionPasistaMonto.toFixed(0)).toBe("100000");

  // Gastos extras desde el listado: Valija $50.000 + Envío $30.000.
  await page.goto("/p/vapes/compras");
  await page
    .getByRole("button", { name: /Agregar gastos extras a la compra/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Agregar gastos extras" });
  await sheet.getByLabel("Motivo del gasto 1").fill("Valija");
  await sheet.getByLabel("Monto del gasto 1").fill("50000");
  await sheet.getByRole("button", { name: "Otro gasto" }).click();
  await sheet.getByLabel("Motivo del gasto 2").fill("Envío");
  await sheet.getByLabel("Monto del gasto 2").fill("30000");
  await expect(sheet.getByLabel("Costo final total")).toHaveText(/\$\s*1\.180\.000/);
  await expect(sheet.getByLabel("Costo final por unidad")).toHaveText(/\$\s*11\.800/);
  await sheet.getByRole("button", { name: "Guardar gastos" }).click();
  await expect(sheet).toBeHidden();

  const despues = await db.compra.findUniqueOrThrow({ where: { id: compra.id } });
  expect(despues.costoFinalTotal.toFixed(0)).toBe("1180000");
  expect(despues.costoUnitarioFinalPromedio.toFixed(0)).toBe("11800");
  const variante = await db.variante.findUniqueOrThrow({ where: { id: mango.id } });
  expect(variante.ultimoCosto?.toFixed(0)).toBe("11800");

  // Detalle: tarjeta grande y costo final por unidad de cada modelo.
  await page.goto(`/p/vapes/compras/${compra.id}`);
  await expect(page.getByLabel("Costo final total", { exact: true })).toHaveText(
    /\$\s*1\.180\.000/,
  );
  await expect(page.getByLabel(`Costo final por unidad de ${nc}`)).toHaveText(/\$\s*11\.800/);

  // Pasista: pendiente $100.000 en el mes → marcar pagada.
  await page.goto("/p/vapes/pasista");
  const idCompra = `VAP-C-${String(compra.numero).padStart(6, "0")}`;
  const fila = page.getByRole("row", { name: new RegExp(idCompra) });
  await expect(fila).toContainText(/\$\s*100\.000/);
  await expect(fila).toContainText("Pendiente");
  await expect(page.getByLabel("Total a pagar del mes")).toContainText(/\$\s*100\.000/);
  await fila.getByRole("button", { name: "Marcar pagada" }).click();
  const pago = page.getByRole("dialog", {
    name: new RegExp(`Marcar pagada la comisión de ${idCompra}`),
  });
  await pago.getByLabel("Cómo se le pagó").selectOption("TRANSFERENCIA");
  await pago.getByLabel("Referencia (opcional)").fill("TRF-E2E");
  await pago.getByRole("button", { name: "Confirmar pago" }).click();
  await expect(fila).toContainText("Pagada");
  const comision = await db.comisionPasista.findFirstOrThrow({ where: { compraId: compra.id } });
  expect(comision).toMatchObject({
    estado: "PAGADA",
    medioPago: "TRANSFERENCIA",
    referencia: "TRF-E2E",
  });

  // Detalle de la comisión: la compra con sus productos.
  await fila.getByRole("link", { name: idCompra, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Comisión de ${idCompra}` })).toBeVisible();
  await expect(page.getByText(producto.nombreCompleto).first()).toBeVisible();

  // Excel del mes.
  const xlsx = await page.request.get("/api/p/vapes/pasista/exportar");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
});

test("Pasista aparece en la navegación del dueño y Trinidad no tiene acceso", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/vapes/pasista");
  await expect(page.getByRole("heading", { name: "Pasista", exact: true })).toBeVisible();
  if (esMobile(page)) {
    await page.getByRole("button", { name: "Más" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: /Pasista/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } else {
    await expect(page.locator("aside").getByRole("link", { name: "Pasista" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  // Un solo ítem activo en el cotizador mayorista.
  await page.goto("/p/vapes/cotizador/mayorista/nueva");
  if (!esMobile(page)) {
    await expect(page.locator('aside a[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('aside a[aria-current="page"]')).toHaveText(/Cotizar por mayor/);
  }

  await page.context().clearCookies();
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes/pasista");
  await expect(page).toHaveURL(/sin-acceso/);
  const nav = page.locator('aside, nav[aria-label="Navegación inferior"]');
  await expect(nav.locator('a[href^="/p/vapes/pasista"]')).toHaveCount(0);
  const r = await page.request.get("/api/p/vapes/pasista/exportar");
  expect(r.status()).toBe(403);
});

/** Capturas para verificación manual (solo con CAPTURAS_DIR): 1440 en escritorio y 375 en el celular. */
async function captura(page: Page, nombre: string, foco?: Locator) {
  const dir = process.env.CAPTURAS_DIR;
  if (!dir) return;
  if (esMobile(page)) await page.setViewportSize({ width: 375, height: 812 });
  const ancho = esMobile(page) ? 375 : 1440;
  if (foco) await foco.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, `${nombre}-${ancho}.png`) });
}

test("Pasista en Cosmetic: la comisión de la compra con su detalle, el cálculo, los totales y los links", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const marca = await db.marca.create({
    data: { panelId: PANEL_COSMETIC, nombre: `Crema${sufijo}` },
  });
  const producto = await db.producto.create({
    data: {
      panelId: PANEL_COSMETIC,
      marcaId: marca.id,
      nombre: "Hidratante",
      especificacion: "50ml",
      precioVenta: 9000,
      variantes: {
        create: [
          { panelId: PANEL_COSMETIC, nombre: "Rosa", sku: `E2E-PC${sufijo}-1` },
          { panelId: PANEL_COSMETIC, nombre: "Coco", sku: `E2E-PC${sufijo}-2` },
        ],
      },
    },
  });
  const nc = (await db.producto.findUniqueOrThrow({ where: { id: producto.id } })).nombreCompleto;
  await db.proveedor.create({
    data: {
      panelId: PANEL_COSMETIC,
      nombre: "Sofía",
      nombreTienda: `Belleza ${sufijo}`,
      productos: {
        create: {
          panelId: PANEL_COSMETIC,
          productoId: producto.id,
          precio: 2500,
          moneda: "ARS",
          usuarioId: dueno.id,
        },
      },
    },
  });

  await loginDueno(page);
  await page.goto("/p/cosmetic/compras/nueva");
  await page.getByRole("radio", { name: new RegExp(`Belleza ${sufijo}`) }).click();
  await page.getByRole("radio", { name: /Principal/ }).click();
  await page.getByRole("button", { name: "Continuar con Principal" }).click();
  // Desde el catálogo del proveedor: 6 Rosa + 4 Coco a $ 2.500.
  await page.getByRole("button", { name: `Agregar ${nc}` }).click();
  const hoja = page.getByRole("dialog", { name: nc });
  await hoja.getByLabel("Cantidad a agregar de Rosa").fill("6");
  await hoja.getByLabel("Cantidad a agregar de Coco").fill("4");
  await hoja.getByRole("button", { name: /Agregar 10 u\./ }).click();
  await page.getByRole("checkbox", { name: /Comisión del/ }).check();
  await expect(page.getByLabel("Comisión del pasista", { exact: true })).toHaveText(/\$\s*2\.500/);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/p\/cosmetic\/compras\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nueva"),
  );
  await page.getByRole("button", { name: /^Recibido/ }).click();
  await page
    .getByRole("dialog", { name: "¿Llegó la mercadería?" })
    .getByRole("button", { name: "Recibido", exact: true })
    .click();
  await expect(page.getByText("Recibida", { exact: true })).toBeVisible();
  const compra = await db.compra.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, items: { some: { productoId: producto.id } } },
  });
  const idCompra = `COS-C-${String(compra.numero).padStart(6, "0")}`;

  // Desde la compra, a su comisión en Pasista.
  await page.getByRole("link", { name: /Ver comisión en Pasista/ }).click();
  await expect(page.getByRole("heading", { name: `Comisión de ${idCompra}` })).toBeVisible();
  const calculo = page.getByLabel("Cálculo de la comisión");
  await expect(calculo).toContainText(/Total de la compra\s*\$\s*25\.000/);
  await expect(calculo).toContainText(/× 10% del pasista\s*\$\s*2\.500/);
  await expect(page.getByLabel("Comisión total")).toHaveText(/\$\s*2\.500/);
  await expect(page.getByText(/Rosa/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Coco/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByLabel("Total de los productos")).toContainText(/10 u\.\)\s*\$\s*25\.000/);
  await captura(page, "bloqueB-detalle", calculo);

  // Listado del mes: la compra con su proveedor, total, % y comisión; totales del período.
  await page.goto("/p/cosmetic/pasista");
  await expect(page.getByRole("heading", { name: "Pasista", exact: true })).toBeVisible();
  if (!esMobile(page)) {
    const fila = page.getByRole("row", { name: new RegExp(idCompra) });
    await expect(fila).toContainText(`Belleza ${sufijo}`);
    await expect(fila).toContainText(/\$\s*25\.000/);
    await expect(fila).toContainText("10%");
    await expect(fila).toContainText(/\$\s*2\.500/);
    await expect(fila).toContainText("Pendiente");
    await expect(fila.getByRole("link", { name: `Ver la compra ${idCompra}` })).toHaveAttribute(
      "href",
      `/p/cosmetic/compras/${compra.id}`,
    );
  } else {
    await expect(page.getByRole("link", { name: new RegExp(idCompra) }).first()).toContainText(
      /\$\s*2\.500/,
    );
  }
  await expect(page.getByLabel("Comisión total del mes")).toHaveText(/\$\s*[\d.]+/);
  await expect(page.getByLabel("Total a pagar del mes")).toBeVisible();
  await captura(page, "bloqueB-listado");
  await captura(page, "bloqueB-totales", page.getByLabel("Total a pagar del mes"));
});

test("Pasista en Especiales: navegación y página del módulo", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/especiales/pasista");
  await expect(page.getByRole("heading", { name: "Pasista", exact: true })).toBeVisible();
  await expect(page.getByLabel("Resumen del pasista")).toBeVisible();
  if (!esMobile(page))
    await expect(page.locator("aside").getByRole("link", { name: "Pasista" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  await captura(page, "bloqueB-especiales");
});
