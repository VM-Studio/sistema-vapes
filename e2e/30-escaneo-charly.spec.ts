import { mkdirSync } from "node:fs";

import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_CHARLY, PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  IGNITE_V80,
  llamarAccion,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
  stock,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * «Escanea Charly»: Trinidad vende desde el galpón Mercedes y pide que Charly
 * escanee; Charly (perfil Escaneo) solo ve su pantalla, escanea, el servidor
 * marca la diferencia exacta (sabor) y, cuando todo coincide, «Vape escaneado»
 * deja la venta lista para retirar. Desde Ayres Plaza la opción no existe.
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/a3";
const modal = (page: Page) => page.getByTestId("modal-venta");
const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });
const telefono = () => `11 4${`${Date.now()}`.slice(-7)}`;

async function loginTrinidad(page: Page) {
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
}

/** Abre el modal, elige el galpón, escanea `codigos` y llega al paso «¿Cómo paga?». */
async function hastaElPago(page: Page, galpon: string, codigos: string[], cliente: string) {
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
}

async function confirmarVenta(page: Page): Promise<string> {
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  return (await id.textContent())!;
}

/** Charly en su celular (375 px, táctil). */
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

test("Trinidad pide «Escanea Charly» en Mercedes; Charly escanea, el error marca el sabor y la venta queda lista para retirar", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio + celular de Charly");
  test.setTimeout(150_000);
  mkdirSync(CARPETA, { recursive: true });
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const frutilla = await codigoDe(IGNITE_V80, "Strawberry Watermelon");
  const stockAntes = await stock(IGNITE_V80, "Mango Ice", "Mercedes");

  // --- Trinidad vende 2 Mango desde Mercedes y activa «Escanea Charly».
  await loginTrinidad(page);
  await hastaElPago(page, "Mercedes", [mango, mango], "Cliente Mercedes");
  const interruptor = modal(page).getByRole("switch", { name: "Escanea Charly" });
  await expect(interruptor).toHaveAttribute("aria-checked", "false");
  await interruptor.click();
  await expect(interruptor).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `${CARPETA}/charly-modal-toggle-1440.png` });
  const codigo = await confirmarVenta(page);
  await expect(modal(page).getByTestId("escaneo-pedido")).toContainText("Charly");

  const venta = await db.venta.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigo } });
  expect(venta.escaneoRemoto).toBe("PENDIENTE");
  // La venta ya descontó la variante exacta de Mercedes.
  expect(await stock(IGNITE_V80, "Mango Ice", "Mercedes")).toBe(stockAntes - 2);

  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByTestId("badge-escaneo")).toHaveText("Esperando escaneo de Charly");
  await expect(page.getByTestId("escaneo-remoto-venta")).toContainText("Pedido por Trinidad");

  // --- Charly en el celular: entra directo a su pantalla y ve SOLO esa venta.
  const { contexto, page: cel } = await celularCharly(browser, baseURL);
  await expect(cel).toHaveURL(/\/p\/vapes\/escaneo$/);
  const lista = cel.getByTestId("venta-para-escanear");
  await expect(lista).toHaveCount(1);
  await expect(lista).toContainText(codigo);
  await expect(lista).toContainText("Trinidad");
  await expect(lista).toContainText("Mango Ice");
  await expect(lista).toContainText("8000 pitadas");
  // Sin navegación del sistema.
  await expect(cel.getByRole("navigation")).toHaveCount(0);
  await cel.screenshot({ path: `${CARPETA}/charly-lista-375.png`, fullPage: true });
  await cel.setViewportSize({ width: 1440, height: 900 });
  await cel.screenshot({ path: `${CARPETA}/charly-lista-1440.png`, fullPage: true });
  await cel.setViewportSize({ width: 375, height: 812 });

  // Ninguna otra ruta ni acción del sistema.
  await cel.goto("/p/vapes/ventas");
  await expect(cel).toHaveURL(/\/p\/vapes\/sin-acceso$/);
  await expect(cel.getByRole("link", { name: /Volver a las ventas para escanear/ })).toBeVisible();
  await cel.goto("/p/vapes/productos");
  await expect(cel).toHaveURL(/\/p\/vapes\/sin-acceso$/);
  await cel.goto("/p/vapes");
  await expect(cel).toHaveURL(/\/p\/vapes\/escaneo$/);
  await cel.goto("/paneles");
  await expect(cel).toHaveURL(/\/p\/vapes\/escaneo$/);
  await cel.goto("/ayuda");
  await expect(cel).toHaveURL(/\/sin-acceso$/);
  await cel.goto("/usuarios");
  await expect(cel).toHaveURL(/\/sin-acceso$/);
  const api = await cel.request.get("/api/p/vapes/stock/exportar");
  expect(api.status()).toBe(403);
  const accion = await llamarAccion(cel, "unidadesPorDepositoAction", undefined, "/p/vapes/ventas");
  expect(accion).toContain("FORBIDDEN");
  const pedir = await llamarAccion(
    cel,
    "pedirEscaneoAction",
    { ventaId: venta.id },
    `/p/vapes/ventas/${venta.id}`,
  );
  expect(pedir).toContain("FORBIDDEN");

  // --- Escanea: primero un sabor equivocado → error específico de sabor.
  await cel.goto("/p/vapes/escaneo");
  await cel.getByTestId("venta-para-escanear").click();
  await expect(cel.getByTestId("venta-escaneando")).toHaveText(codigo);
  const boton = cel.getByRole("button", { name: "Vape escaneado" });
  await expect(boton).toBeDisabled();
  await soltarFoco(cel);
  await pistola(cel, frutilla);
  const error = cel.getByTestId("error-escaneo");
  await expect(error).toContainText("Sabor distinto");
  await expect(error).toContainText(
    "Sabor: escaneaste «Strawberry Watermelon», la venta lleva «Mango Ice».",
  );
  await expect(cel.getByTestId("item-escaneo")).toHaveAttribute("data-error", "sabor");
  await expect(cel.getByTestId("contador-item")).toContainText("0/2");
  await expect(boton).toBeDisabled();
  await cel.screenshot({ path: `${CARPETA}/charly-error-sabor-375.png` });

  // --- Ahora los correctos: 1/2, 2/2 → «Vape escaneado».
  await pistola(cel, mango);
  await expect(cel.getByTestId("contador-item")).toContainText("1/2");
  await expect(error).toBeHidden();
  await expect(boton).toBeDisabled();
  await pistola(cel, mango);
  await expect(cel.getByTestId("progreso-escaneo")).toHaveText("Todo coincide");
  await expect(boton).toBeEnabled();
  await cel.screenshot({ path: `${CARPETA}/charly-todo-coincide-375.png` });
  await cel.setViewportSize({ width: 1440, height: 900 });
  await cel.screenshot({ path: `${CARPETA}/charly-todo-coincide-1440.png`, fullPage: true });
  await cel.setViewportSize({ width: 375, height: 812 });
  await boton.click();
  await expect(cel.getByText("No hay ventas para escanear")).toBeVisible();
  await expect(cel.getByTestId("venta-para-escanear")).toHaveCount(0);
  await contexto.close();

  const escaneada = await db.venta.findUniqueOrThrow({ where: { id: venta.id } });
  expect(escaneada.escaneoRemoto).toBe("ESCANEADA");
  expect(escaneada.verificadaPorEscaneo).toBe(true);
  expect(escaneada.escaneoDetalle).toEqual([
    { codigo: mango, varianteId: expect.any(String) },
    { codigo: mango, varianteId: expect.any(String) },
  ]);
  // Escanear no mueve stock de nuevo.
  expect(await stock(IGNITE_V80, "Mango Ice", "Mercedes")).toBe(stockAntes - 2);

  // --- Trinidad: listo para retirar (detalle, inicio y listado filtrado).
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByTestId("badge-escaneo")).toHaveText(
    "Escaneado por Charly · listo para retirar",
  );
  await expect(page.getByTestId("escaneo-remoto-venta")).toContainText(
    "Stock descontado de Mercedes: 2 unidades",
  );
  await expect(page.getByText("Verificada", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${CARPETA}/charly-trinidad-detalle-1440.png`, fullPage: true });
  await page.goto("/p/vapes");
  const aviso = page.getByTestId("avisos-escaneo");
  await expect(aviso).toContainText(codigo);
  await expect(aviso).toContainText("listo para retirar");
  await page.screenshot({ path: `${CARPETA}/charly-trinidad-inicio-1440.png`, fullPage: true });
  await page.goto("/p/vapes/ventas?escaneo=ESCANEADA");
  await expect(
    page.getByRole("row").filter({ hasText: codigo }).getByTestId("badge-escaneo"),
  ).toHaveText("Escaneado por Charly · listo para retirar");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await page.screenshot({ path: `${CARPETA}/charly-trinidad-detalle-375.png`, fullPage: true });
});

test("desde Ayres Plaza no aparece «Escanea Charly» (ni al vender ni en el detalle); el pedido se puede hacer y cancelar después en Mercedes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const blue = await codigoDe(IGNITE_V80, "Blue Razz Ice");
  await loginTrinidad(page);
  await hastaElPago(page, "Ayres Plaza", [blue], "Cliente Ayres");
  await expect(modal(page).getByRole("switch", { name: "Escanea Charly" })).toHaveCount(0);
  const codigo = await confirmarVenta(page);
  const venta = await db.venta.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigo } });
  expect(venta.escaneoRemoto).toBeNull();
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByRole("heading", { name: `Venta ${codigo}` })).toBeVisible();
  await expect(page.getByTestId("escaneo-remoto-venta")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Escanea Charly" })).toHaveCount(0);

  // En Mercedes, sin el toggle: se pide desde el detalle y se cancela.
  await hastaElPago(page, "Mercedes", [blue], "Cliente Después");
  const otro = await confirmarVenta(page);
  const ventaMercedes = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: otro },
  });
  await page.goto(`/p/vapes/ventas/${ventaMercedes.id}`);
  await page.getByRole("button", { name: "Escanea Charly" }).click();
  await expect(page.getByTestId("badge-escaneo")).toHaveText("Esperando escaneo de Charly");
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.getByTestId("badge-escaneo")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Escanea Charly" })).toBeVisible();
  expect(
    (await db.venta.findUniqueOrThrow({ where: { id: ventaMercedes.id } })).escaneoRemoto,
  ).toBeNull();
});

test("Usuarios: un dueño crea un usuario con el «Perfil Escaneo (Charly)» y queda solo con Escaneo remoto", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto("/usuarios");
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  const hoja = page.getByRole("dialog", { name: "Nuevo usuario" });
  const email = `escaneo-${Date.now()}@negocio.com`;
  await hoja.getByLabel("Nombre").fill("Charly Dos");
  await hoja.getByLabel("Email").fill(email);
  await hoja.getByLabel("Contraseña inicial").fill("Escaneo2026x");
  await hoja.getByRole("switch", { name: "Perfil Escaneo (Charly)" }).click();
  await page.getByRole("button", { name: "Crear usuario" }).click();
  await expect(page).toHaveURL(/\/usuarios\/[^/?]+\?perfil=escaneo$/);
  await expect(page.getByTestId("aviso-perfil-escaneo")).toBeVisible();
  await page.screenshot({ path: `${CARPETA}/charly-usuarios-perfil-1440.png`, fullPage: true });
  await page.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(page.getByText("Acceso guardado")).toBeVisible();
  const u = await db.usuario.findUniqueOrThrow({
    where: { email },
    include: { permisos: true, paneles: true },
  });
  expect(u.paneles.map((p) => p.panelId)).toEqual([PANEL_VAPES]);
  expect(u.permisos.filter((p) => p.puedeVer).map((p) => p.modulo)).toEqual(["ESCANEO"]);
});
