import { mkdirSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  EMAIL_DUENO,
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
 * Pedido de los dueños (2026-10-29): «Mis clientes» de Trinidad (cargar la
 * cartera que ya tenía y que la venta a un cliente nuevo lo sume con su
 * venta), borrador automático de «Nueva compra» (se sale a otra sección y se
 * retoma) y producto nuevo desde la ficha del proveedor.
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/pedido-1029";
const n = `${Date.now()}`.slice(-6);
const modal = (page: Page) => page.getByTestId("modal-venta");
const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });

test("Trinidad prepara su cartera y la venta a un cliente nuevo lo suma con esa venta", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio (crea datos únicos)");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  await page.getByRole("link", { name: "Mis clientes" }).first().click();
  await expect(page.getByRole("heading", { name: "Mis clientes", level: 1 })).toBeVisible();

  // Uno por uno («ya lo tenía»).
  await page.getByRole("button", { name: "Agregar cliente" }).click();
  const hoja = page.getByRole("dialog", { name: "Agregar cliente que ya tenés" });
  await hoja.getByLabel("Nombre").fill(`Previo ${n}`);
  await hoja.getByLabel("Teléfono").fill(`11 6${n.slice(0, 3)} ${n.slice(-4)}`);
  await hoja.getByRole("button", { name: "Guardar y cargar otro" }).click();
  await expect(page.getByText("Cliente cargado en tu cartera")).toBeVisible();
  await hoja.getByRole("button", { name: "Listo" }).click();

  // Varios de una (pegando la lista).
  await page.getByRole("button", { name: "Cargar varios" }).click();
  const varios = page.getByRole("dialog", { name: "Cargar varios clientes" });
  await varios
    .getByRole("textbox")
    .fill(
      `Ana ${n}, 11 5${n.slice(0, 3)} ${n.slice(-4)}\nBeto ${n}; 11 4${n.slice(0, 3)}${n.slice(-4)}`,
    );
  await varios.getByRole("button", { name: "Cargar" }).click();
  await expect(varios.getByTestId("resultado-carga")).toContainText("Cargados: 2");
  await varios.getByRole("button", { name: "Listo" }).click();
  const resumen = page.getByTestId("resumen-cartera");
  await expect(resumen).toContainText("Ya los tenía");
  mkdirSync(CARPETA, { recursive: true });
  await page.screenshot({ path: `${CARPETA}/mis-clientes-1440.png`, fullPage: true });
  const previos = await db.cliente.count({
    where: { panelId: PANEL_VAPES, vendedorId: trinidad.id, creadoEnVentaId: null },
  });
  expect(previos).toBeGreaterThanOrEqual(3);

  // Venta a un cliente nuevo: se suma a la cartera con esa venta.
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await modal(page)
    .getByRole("radio", { name: /Ayres Plaza/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await soltarFoco(page);
  await pistola(page, mango);
  await continuar(page).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill(`Nuevo ${n}`);
  await modal(page)
    .getByLabel("Teléfono")
    .fill(`11 3${n.slice(0, 3)} ${n.slice(-4)}`);
  await continuar(page).click();
  await modal(page).getByRole("radio", { name: "Efectivo" }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;

  await page.goto("/p/vapes/mis-clientes?filtro=nuevos");
  const fila = page.getByRole("row").filter({ hasText: `Nuevo ${n}` });
  await expect(fila).toContainText(`Nuevo · ${codigo}`);
  await fila.getByRole("link", { name: `Nuevo ${n}` }).click();
  await expect(page.getByTestId("origen-cliente-cartera")).toContainText(codigo);
  await page.screenshot({ path: `${CARPETA}/cliente-nuevo-1440.png`, fullPage: true });

  // El dueño ve la cartera de Trinidad en Equipo, con la venta que trajo al nuevo.
  await page.context().clearCookies();
  await loginDueno(page);
  await page.goto(`/p/vapes/equipo/${trinidad.id}/clientes?filtro=nuevos`);
  await expect(page.getByRole("row").filter({ hasText: `Nuevo ${n}` })).toContainText(codigo);
});

test("borrador de compra: se sale a otra sección y se retoma desde Compras", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombre: "Mango Ice", producto: { nombreCompleto: IGNITE_V80 } },
  });
  const proveedor = await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Borra",
      nombreTienda: `Tienda Borrador ${n}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: variante.productoId,
          precio: 6000,
          moneda: "ARS",
          usuarioId: dueno.id,
        },
      },
    },
  });
  await loginDueno(page);
  await page.goto("/p/vapes/compras/nueva");
  await page.getByRole("radio", { name: new RegExp(`Tienda Borrador ${n}`) }).click();
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();
  await soltarFoco(page);
  await pistola(page, await codigoDe(IGNITE_V80, "Mango Ice"));
  const cantidad = page.getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`);
  await cantidad.fill("12");
  await expect(page.getByTestId("estado-borrador")).toContainText("Borrador guardado", {
    timeout: 10_000,
  });
  // Los pesos llevan su equivalente en USDT abajo.
  await expect(
    page.getByTestId("costo-final-por-unidad").getByTestId("en-usdt").first(),
  ).toBeVisible();

  // Se va a otra sección sin confirmar…
  await page.getByRole("link", { name: "Productos" }).first().click();
  await page.waitForURL(/\/p\/vapes\/productos/);
  // …y la retoma desde Compras.
  await page.goto("/p/vapes/compras");
  const borrador = page.getByTestId("borrador-compra").filter({ hasText: `Tienda Borrador ${n}` });
  await expect(borrador).toContainText("12 u.");
  await page.screenshot({ path: `${CARPETA}/compras-en-curso-1440.png`, fullPage: true });
  await borrador.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("12");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/p\/vapes\/compras\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nueva"),
  );
  expect(await db.borradorCompra.count({ where: { proveedorId: proveedor.id } })).toBe(0);
  expect(await db.compra.count({ where: { proveedorId: proveedor.id } })).toBe(1);
});

test("producto nuevo desde la ficha del proveedor: queda vinculado con su precio", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const proveedor = await db.proveedor.create({
    data: { panelId: PANEL_VAPES, nombre: "Listas", nombreTienda: `Lista Grande ${n}` },
  });
  await loginDueno(page);
  await page.goto(`/p/vapes/proveedores/${proveedor.id}`);
  await page.getByRole("button", { name: "Nuevo producto" }).click();
  const hoja = page.getByRole("dialog", { name: "Nuevo producto" });
  await hoja.locator("#precio-proveedor").fill("4,5");
  await hoja.getByLabel("Marca").fill(`Marca ${n}`);
  await hoja.getByLabel("Modelo").fill("Nuevo");
  await hoja.getByLabel("Pitadas").fill("9000");
  await hoja.getByLabel("Precio de venta").fill("18000");
  await hoja.getByRole("textbox", { name: "Sabor" }).first().fill("Menta");
  await page.screenshot({ path: `${CARPETA}/nuevo-producto-proveedor-1440.png` });
  await hoja.getByRole("button", { name: "Crear producto" }).click();
  await expect(hoja).toBeHidden();
  const nombre = `Marca ${n} Nuevo 9000`;
  await expect(page.getByRole("list", { name: "Productos del proveedor" })).toContainText(nombre);
  const pp = await db.proveedorProducto.findFirstOrThrow({
    where: { proveedorId: proveedor.id },
    include: { producto: true },
  });
  expect(pp.producto.nombreCompleto).toBe(nombre);
  expect(pp.precio.toString()).toBe("4.5");
  expect(pp.moneda).toBe("USDT");
});
