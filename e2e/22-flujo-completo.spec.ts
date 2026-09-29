import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  db,
  EMAIL_DUENO,
  ELF_BAR_BC5000,
  login,
  loginDueno,
  PANEL_COSMETIC,
  PANEL_VAPES,
  PASSWORD_DUENO,
  pistola,
  soltarFoco,
} from "./helpers";

/**
 * Flujo completo de la v2 (cierre de la reforma): cada usuario entra a sus
 * sistemas; en Vapes se carga stock eligiendo galpón, se vende desde el modal
 * con un cliente nuevo, se registra una garantía, se convierte una cotización
 * mayorista en venta y el dashboard lo refleja; lo esencial se repite en
 * Cosmetic; los paneles no se mezclan y Trinidad no ve costos ni otros sistemas.
 * Usa un producto propio (código de barras único por corrida) para no depender
 * del stock que tocan los demás specs.
 */
test.describe.configure({ mode: "serial" });

const n = `${Date.now()}`.slice(-6);
function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}
const VAPES = {
  codigo: ean13(`779220${n}`),
  marca: "Flujo",
  modelo: `F${n}`,
  especificacion: "2000",
  sabor: "Uva",
  nombre: `Flujo F${n} 2000`,
};
const COSMETIC = {
  codigo: ean13(`779221${n}`),
  marca: "Flujo Cosmetic",
  modelo: `Crema ${n}`,
  especificacion: "50ml",
  nombre: `Flujo Cosmetic Crema ${n} 50ml`,
};
const CLIENTE_VAPES = {
  nombre: `Cliente Flujo ${n}`,
  telefono: `11 7${n.slice(0, 3)} ${n.slice(-4)}`,
};
const CLIENTE_MAYORISTA = {
  nombre: `Kiosco Flujo ${n}`,
  telefono: `11 8${n.slice(0, 3)} ${n.slice(-4)}`,
};
const CLIENTE_COSMETIC = {
  nombre: `Clienta Cosmetic ${n}`,
  telefono: `11 9${n.slice(0, 3)} ${n.slice(-4)}`,
};

let ventaVapes = "";

/** KPIs del día en el dashboard de Vapes: cantidad de ventas y «Vapes vendidos». */
async function leerVentasDelDia(page: Page) {
  await page.goto("/p/vapes?modo=diario");
  const numero = async (testId: string) => {
    const kpi = page.getByTestId(testId);
    await expect(kpi).toBeVisible();
    const texto = (await kpi.locator("p").nth(1).textContent()) ?? "";
    return Number(texto.replace(/\D/g, ""));
  };
  return { ventas: await numero("kpi-Ventas"), unidades: await numero("kpi-Vapes vendidos") };
}

const modalVenta = (page: Page) => page.getByTestId("modal-venta");

async function stockDe(panelId: string, codigo: string, deposito: string) {
  const s = await db.stock.findFirst({
    where: { panelId, variante: { codigoBarras: codigo }, deposito: { nombre: deposito } },
  });
  return s?.cantidad ?? 0;
}

/** Carga de stock con la pistola: galpón → código nuevo (alta rápida) → cantidad → confirmar. */
async function cargarProductoNuevo(
  page: Page,
  slug: string,
  galpon: string,
  p: { codigo: string; marca: string; modelo: string; especificacion: string; sabor?: string },
  etiqueta: string,
  cantidad: number,
  titulo: string,
) {
  await page.goto(`/p/${slug}/productos/cargar`);
  await expect(page.getByRole("heading", { name: "¿En qué galpón vas a cargar?" })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(galpon) }).click();
  await page.getByRole("button", { name: `Continuar con ${galpon}` }).click();
  await expect(page.getByTestId("galpon-actual")).toHaveText(galpon);
  await soltarFoco(page);
  await pistola(page, p.codigo);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Producto nuevo" })).toBeVisible();
  await sheet.getByLabel("Marca").fill(p.marca);
  await sheet.getByLabel("Modelo").fill(p.modelo);
  await sheet.getByLabel(etiqueta).fill(p.especificacion);
  if (p.sabor) await sheet.getByLabel("Sabor", { exact: true }).fill(p.sabor);
  await sheet.getByLabel("Precio de venta").fill("10000");
  await sheet.getByRole("button", { name: "Guardar y agregar" }).click();
  const cantidadInput = page.getByLabel(`Cantidad de ${titulo}`);
  await expect(cantidadInput).toHaveValue("1");
  await cantidadInput.fill(String(cantidad));
  await page.getByRole("button", { name: `Cargar ${cantidad} unidades en ${galpon}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar carga" }).click();
  await expect(page.getByText(`Cargaste ${cantidad} unidades en ${galpon}`)).toBeVisible();
}

/** Venta desde el modal: galpón → escaneos → cliente nuevo → medio de pago → ID de venta. */
async function venderConClienteNuevo(
  page: Page,
  slug: string,
  galpon: string,
  codigo: string,
  unidades: number,
  cliente: { nombre: string; telefono: string },
) {
  await page.goto(`/p/${slug}/ventas`);
  await page.getByRole("button", { name: "Generar venta" }).click();
  const modal = modalVenta(page);
  await expect(modal).toBeVisible();
  await modal.getByRole("radio", { name: new RegExp(galpon) }).click();
  await modal.getByRole("button", { name: `Continuar con ${galpon}` }).click();
  await expect(modal.getByTestId("galpon-venta")).toContainText(galpon);
  await soltarFoco(page);
  for (let i = 0; i < unidades; i++) await pistola(page, codigo);
  await expect(modal.locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  const continuar = modal.getByRole("button", { name: "Continuar", exact: true });
  await continuar.click();
  await modal.getByRole("button", { name: "Sí", exact: true }).click();
  await modal.getByLabel("Nombre").fill(cliente.nombre);
  await modal.getByLabel("Teléfono").fill(cliente.telefono);
  await expect(continuar).toBeEnabled();
  await continuar.click();
  await modal.getByRole("radio", { name: "Efectivo" }).click();
  await modal.getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal.getByTestId("id-venta");
  await expect(id).toHaveText(/^[A-Z]{3}-\d{6}$/, { timeout: 20_000 });
  return (await id.textContent())!;
}

test("cada usuario entra a sus sistemas: los dueños al selector, Trinidad directo a Vapes", async ({
  page,
}) => {
  const agustina = await db.usuario.findFirstOrThrow({ where: { nombre: "Agustina" } });
  for (const email of [EMAIL_DUENO, agustina.email]) {
    await login(page, email, PASSWORD_DUENO);
    await expect(page).toHaveURL(/\/paneles$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué sistema querés abrir?");
    for (const nombre of ["Vapes", "Cosmetic", "Especiales"]) {
      await expect(page.getByRole("heading", { name: nombre, level: 2 })).toBeVisible();
    }
    await page.context().clearCookies();
  }
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await expect(page).toHaveURL(/\/p\/vapes$/);
});

test("Vapes: cargar stock en un galpón → venta con cliente nuevo → garantía → mayorista convertida → dashboard", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio (crea datos únicos)");
  test.setTimeout(180_000);
  await loginDueno(page);
  const ventasHoyAntes = await leerVentasDelDia(page);

  // 1. Stock: 20 unidades del producto nuevo en Ayres Plaza (alta rápida desde la pistola).
  await cargarProductoNuevo(
    page,
    "vapes",
    "Ayres Plaza",
    VAPES,
    "Pitadas",
    20,
    `${VAPES.nombre} — ${VAPES.sabor}`,
  );
  expect(await stockDe(PANEL_VAPES, VAPES.codigo, "Ayres Plaza")).toBe(20);
  expect(await stockDe(PANEL_VAPES, VAPES.codigo, "Mercedes")).toBe(0);

  // 2. Venta desde el modal con un cliente nuevo.
  ventaVapes = await venderConClienteNuevo(
    page,
    "vapes",
    "Ayres Plaza",
    VAPES.codigo,
    2,
    CLIENTE_VAPES,
  );
  expect(ventaVapes).toMatch(/^VAP-\d{6}$/);
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: ventaVapes },
    include: { cliente: true, items: true },
  });
  expect(venta.cliente.nombre).toBe(CLIENTE_VAPES.nombre);
  expect(venta.medioPago).toBe("EFECTIVO");
  expect(venta.items[0]!.cantidad).toBe(2);
  expect(Number(venta.total)).toBe(20000);
  expect(await stockDe(PANEL_VAPES, VAPES.codigo, "Ayres Plaza")).toBe(18);

  // 3. Devolución por garantía vinculada a esa venta: sale 1 unidad nueva de Ayres Plaza.
  await page.goto("/p/vapes/devoluciones");
  await page.getByRole("button", { name: "Registrar devolución" }).click();
  const dev = page.getByRole("dialog", { name: "Registrar devolución" });
  await dev.getByLabel("Buscá el cliente por nombre o teléfono").fill(CLIENTE_VAPES.nombre);
  await dev.getByRole("button", { name: new RegExp(CLIENTE_VAPES.nombre) }).click();
  await expect(dev.getByTestId("cliente-seleccionado")).toContainText(CLIENTE_VAPES.nombre);
  await dev.getByRole("radio", { name: new RegExp(ventaVapes) }).click();
  await dev.getByRole("button", { name: "Continuar", exact: true }).click();
  await dev.getByRole("radio", { name: /Ayres Plaza/ }).click();
  await dev.getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await expect(
    dev.getByRole("list", { name: "Productos a entregar" }).getByRole("listitem"),
  ).toHaveCount(1);
  await dev.getByRole("button", { name: "Continuar", exact: true }).click();
  await dev.getByLabel("Observación").fill("No enciende desde el primer día");
  await dev.getByRole("button", { name: "Confirmar devolución" }).click();
  await page.waitForURL(/\/p\/vapes\/devoluciones\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/VAP-D-\d{6}/);
  const garantia = await db.devolucion.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, ventaId: venta.id },
  });
  expect(garantia.estado).toBe("REGISTRADA");
  expect(await stockDe(PANEL_VAPES, VAPES.codigo, "Ayres Plaza")).toBe(17);

  // 4. Cotización mayorista (10 u. → escalón por defecto del panel) convertida en venta.
  await page.goto("/p/vapes/cotizador/mayorista/nueva");
  await soltarFoco(page);
  await pistola(page, VAPES.codigo);
  const cantidad = page.getByLabel(`Cantidad de ${VAPES.nombre} — ${VAPES.sabor}`);
  await expect(cantidad).toBeFocused();
  await cantidad.fill("10");
  await expect(page.getByTestId("chip-escalon")).toHaveText("Escalón desde 10 u.");
  await page.getByRole("button", { name: "Agregar cliente" }).click();
  await page.getByRole("button", { name: "Sí", exact: true }).click();
  await page.getByLabel("Nombre").fill(CLIENTE_MAYORISTA.nombre);
  await page.getByLabel("Teléfono").fill(CLIENTE_MAYORISTA.telefono);
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("codigo-cotizacion")).toHaveText(/^VAP-Q-\d{6}$/);
  await expect(page).toHaveURL(/\/cotizador\/[^/]+\/editar$/);
  const cotizacionId = page.url().split("/cotizador/")[1]!.split("/")[0]!;

  await page.goto(`/p/vapes/cotizador/${cotizacionId}`);
  await page.getByRole("button", { name: "Convertir en venta" }).click();
  const modal = modalVenta(page);
  await expect(modal).toBeVisible();
  await modal.getByRole("radio", { name: /Ayres Plaza/ }).click();
  await modal.getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await expect(modal).toContainText(CLIENTE_MAYORISTA.nombre);
  await modal.getByRole("radio", { name: "Transferencia" }).click();
  await modal.getByRole("button", { name: "Confirmar venta" }).click();
  const idMayorista = modal.getByTestId("id-venta");
  await expect(idMayorista).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const mayorista = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: (await idMayorista.textContent())! },
    include: { items: true },
  });
  expect(mayorista.tipo).toBe("MAYORISTA");
  expect(mayorista.cotizacionId).toBe(cotizacionId);
  expect(mayorista.items[0]!.cantidad).toBe(10);
  // Escalón por defecto de Vapes (10 u. → 5 % menos, redondeado a 10 pesos).
  expect(Number(mayorista.items[0]!.precioUnitario)).toBe(9500);
  expect((await db.cotizacion.findUniqueOrThrow({ where: { id: cotizacionId } })).estado).toBe(
    "CONVERTIDA",
  );
  expect(await stockDe(PANEL_VAPES, VAPES.codigo, "Ayres Plaza")).toBe(7);

  // 5. El dashboard del día refleja las dos ventas nuevas (2 + 10 unidades).
  const ventasHoyDespues = await leerVentasDelDia(page);
  expect(ventasHoyDespues.ventas).toBeGreaterThanOrEqual(ventasHoyAntes.ventas + 2);
  expect(ventasHoyDespues.unidades).toBeGreaterThanOrEqual(ventasHoyAntes.unidades + 12);
});

test("Cosmetic: lo esencial (stock en Principal, venta con cliente nuevo) y aislamiento con Vapes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio (crea datos únicos)");
  test.setTimeout(120_000);
  await loginDueno(page);
  await cargarProductoNuevo(
    page,
    "cosmetic",
    "Principal",
    COSMETIC,
    "Contenido",
    5,
    COSMETIC.nombre,
  );
  expect(await stockDe(PANEL_COSMETIC, COSMETIC.codigo, "Principal")).toBe(5);

  const codigo = await venderConClienteNuevo(
    page,
    "cosmetic",
    "Principal",
    COSMETIC.codigo,
    1,
    CLIENTE_COSMETIC,
  );
  expect(codigo).toMatch(/^COS-\d{6}$/);
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigo },
    include: { cliente: true },
  });
  expect(venta.cliente.panelId).toBe(PANEL_COSMETIC);
  expect(await stockDe(PANEL_COSMETIC, COSMETIC.codigo, "Principal")).toBe(4);

  // Aislamiento: nada de Cosmetic aparece en Vapes (ni al revés).
  expect(
    await db.producto.count({ where: { panelId: PANEL_VAPES, nombre: COSMETIC.modelo } }),
  ).toBe(0);
  expect(
    await db.producto.count({ where: { panelId: PANEL_COSMETIC, nombre: VAPES.modelo } }),
  ).toBe(0);
  await page.goto(`/p/vapes/productos?q=${encodeURIComponent(COSMETIC.modelo)}`);
  await expect(page.getByText("No hay productos con esos filtros")).toBeVisible();
  await page.goto(`/p/vapes/clientes?q=${encodeURIComponent(CLIENTE_COSMETIC.nombre)}`);
  await expect(page.getByText(`No hay clientes con “${CLIENTE_COSMETIC.nombre}”`)).toBeVisible();
  await page.goto(`/p/cosmetic/productos?q=${encodeURIComponent(VAPES.modelo)}`);
  await expect(page.getByText("No hay productos con esos filtros")).toBeVisible();
  // El código de Vapes, escaneado en Cosmetic, es desconocido: abre el alta rápida.
  await page.goto("/p/cosmetic/productos/cargar");
  await page.getByRole("radio", { name: /Principal/ }).click();
  await page.getByRole("button", { name: "Continuar con Principal" }).click();
  await soltarFoco(page);
  await pistola(page, VAPES.codigo);
  await expect(page.getByRole("dialog").getByText("no está cargado en Cosmetic")).toBeVisible();
});

test("Trinidad: sin acceso a Cosmetic ni Especiales y sin costos en Vapes", async ({ page }) => {
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  for (const slug of ["cosmetic", "especiales"]) {
    await page.goto(`/p/${slug}`);
    await expect(page.getByText("No tenés acceso a ese panel")).toBeVisible();
    await expect(page).toHaveURL(/\/p\/vapes$/);
    const api = await page.evaluate(
      async (s) => (await fetch(`/api/p/${s}/catalogo/offline`)).status,
      slug,
    );
    expect(api).toBe(403);
  }

  // Ficha de producto y detalle de venta: sin costos, ganancias ni precios de proveedor.
  const producto = await db.producto.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombreCompleto: ELF_BAR_BC5000 },
  });
  await page.goto(`/p/vapes/productos/${producto.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/último costo/i)).toHaveCount(0);
  await expect(page.getByText("Proveedores que lo venden")).toHaveCount(0);

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, estado: "CONFIRMADA" },
    orderBy: { fecha: "desc" },
  });
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByText(venta.codigo).first()).toBeVisible();
  await expect(page.getByText(/ganancia/i)).toHaveCount(0);
  await expect(page.getByText(/costo/i)).toHaveCount(0);

  // Reportes de dueños, compras y proveedores: fuera de su alcance.
  for (const ruta of ["/p/vapes/reportes/comparador", "/p/vapes/compras", "/p/vapes/proveedores"]) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/sin-acceso$/);
  }
});
