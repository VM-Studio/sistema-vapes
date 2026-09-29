import { mkdirSync, writeFileSync } from "node:fs";

import { Modulo } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, login, loginDueno, PANEL_COSMETIC, PANEL_VAPES } from "./helpers";

/**
 * Reportes: comparador de proveedores (orden, diferencias, badge, USD con
 * cotización), historial de precios, acceso de Trinidad a lo de dueños,
 * aislamiento por panel y el PDF del resumen mensual.
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/r5";
const sufijo = String(Date.now()).slice(-6);
let productoId = "";
const proveedores: Record<string, string> = {};

async function dueno() {
  return db.usuario.findFirstOrThrow({ where: { email: "juancruz@negocio.com" } });
}

/** Producto propio + 3 proveedores en pesos (10.000 / 11.800 / 10.500) + 1 en USD (6,50). */
async function prepararComparador() {
  const usuarioId = (await dueno()).id;
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `Comp${sufijo}` } });
  const producto = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Zeta",
      especificacion: "9000",
      precioVenta: 18000,
      variantes: { create: { panelId: PANEL_VAPES, nombre: "Único", sku: `E2E-R5-${sufijo}` } },
    },
  });
  productoId = producto.id;
  const filas: [string, string, "ARS" | "USD"][] = [
    ["Ana", "10000", "ARS"],
    ["Beto", "11800", "ARS"],
    ["Ceci", "10500", "ARS"],
    ["Dolarero", "6.50", "USD"],
  ];
  for (const [i, [nombre, precio, moneda]] of filas.entries()) {
    const p = await db.proveedor.create({
      data: {
        panelId: PANEL_VAPES,
        nombre: `${nombre} ${sufijo}`,
        nombreTienda: `Tienda ${nombre}`,
        telefono: `+5411${sufijo}${String(i).padStart(2, "0")}`,
        productos: {
          create: {
            panelId: PANEL_VAPES,
            productoId: producto.id,
            precio,
            moneda,
            usuarioId,
          },
        },
      },
    });
    proveedores[nombre] = p.id;
  }
  await db.configuracion.deleteMany({ where: { panelId: PANEL_VAPES, clave: "cotizacionUsd" } });
}

test("comparador: 3 proveedores en pesos ordenados con diferencias y badge; USD aparte sin cotización", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await prepararComparador();
  await loginDueno(page);
  await page.goto("/p/vapes/reportes");
  await expect(page.getByTestId("reporte-comparador")).toHaveAttribute(
    "href",
    "/p/vapes/reportes/comparador",
  );
  await page.goto(`/p/vapes/reportes/comparador?q=Comp${sufijo}`);
  const resultado = page
    .getByTestId("resultados-busqueda")
    .getByRole("link", { name: /Zeta 9000/ });
  await expect(resultado).toHaveAttribute(
    "href",
    `/p/vapes/reportes/comparador?productoId=${productoId}`,
  );
  await page.goto(`/p/vapes/reportes/comparador?productoId=${productoId}`);

  const ofertas = page.getByTestId("oferta");
  await expect(ofertas).toHaveCount(4);
  await expect(page.getByTestId("aviso-monedas")).toBeVisible();
  // Pesos primero (ascendente), el USD en su propio grupo.
  const nombres = await ofertas.evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-proveedor")),
  );
  expect(nombres).toEqual([
    `Ana ${sufijo}`,
    `Ceci ${sufijo}`,
    `Beto ${sufijo}`,
    `Dolarero ${sufijo}`,
  ]);
  await expect(ofertas.nth(0).getByTestId("badge-mas-barato")).toBeVisible();
  await expect(ofertas.nth(1).getByTestId("badge-mas-barato")).toHaveCount(0);
  await expect(ofertas.nth(0).getByTestId("diferencia")).toHaveText("El mejor precio");
  await expect(ofertas.nth(1).getByTestId("diferencia")).toContainText("500");
  await expect(ofertas.nth(1).getByTestId("diferencia")).toContainText("+5 %");
  await expect(ofertas.nth(2).getByTestId("diferencia")).toContainText("1.800");
  await expect(ofertas.nth(2).getByTestId("diferencia")).toContainText("+18 %");
  await expect(ofertas.nth(3).getByTestId("badge-mas-barato")).toContainText("en dólares");
  const nueva = ofertas.nth(0).getByRole("link", { name: /Nueva compra/ });
  await expect(nueva).toHaveAttribute(
    "href",
    `/p/vapes/compras/nueva?proveedor=${proveedores.Ana}`,
  );
  // Sugerencia "X — 4 proveedores — ahorrás hasta …/u".
  await expect(page.getByTestId("sugerencias")).toContainText(`Comp${sufijo} Zeta 9000`);
  await expect(page.getByTestId("sugerencias")).toContainText("1.800/u");
});

test("con cotización del dólar el USD se convierte para ordenar e indica el equivalente", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto(`/p/vapes/reportes/comparador?productoId=${productoId}`);
  await page.getByLabel("Cotización del dólar").fill("1500");
  await page.getByTestId("form-cotizacion").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("aviso-conversion")).toBeVisible();
  await expect(page.getByTestId("aviso-monedas")).toHaveCount(0);
  const ofertas = page.getByTestId("oferta");
  // 6,50 × 1.500 = 9.750 < 10.000: el de dólares pasa a ser el más barato.
  await expect(ofertas.nth(0)).toHaveAttribute("data-proveedor", `Dolarero ${sufijo}`);
  await expect(ofertas.nth(0).getByTestId("badge-mas-barato")).toBeVisible();
  await expect(ofertas.nth(0).getByTestId("precio")).toContainText("US$");
  await expect(ofertas.nth(0).getByTestId("equivalente")).toContainText("9.750");
  await expect(ofertas.nth(1)).toHaveAttribute("data-proveedor", `Ana ${sufijo}`);
  await expect(ofertas.nth(1).getByTestId("diferencia")).toContainText("250");

  mkdirSync(CARPETA, { recursive: true });
  await page.screenshot({ path: `${CARPETA}/comparador-1440.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/p/vapes/reportes/comparador?productoId=${productoId}`);
  await expect(page.getByTestId("oferta")).toHaveCount(4);
  await page.screenshot({ path: `${CARPETA}/comparador-375.png`, fullPage: true });

  // Vista matriz (escritorio): la fila del producto con el más barato resaltado.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/vapes/reportes/comparador?vista=matriz`);
  await expect(page.getByTestId("matriz")).toContainText(`Comp${sufijo} Zeta 9000`);
});

test("cambiar el precio de un proveedor aparece en el historial (reporte de compras)", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await db.proveedorProducto.updateMany({
    where: { panelId: PANEL_VAPES, proveedorId: proveedores.Beto, productoId },
    data: { precio: "11000", actualizadoAt: new Date() },
  });
  await loginDueno(page);
  await page.goto(`/p/vapes/reportes/compras?periodo=hoy&productoId=${productoId}`);
  const fila = page
    .getByRole("row")
    .filter({ hasText: `Beto ${sufijo}` })
    .filter({ hasText: "11.000" });
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText("11.800");
  await expect(fila).toContainText("-6,8 %");
  // Excel del mismo reporte.
  const r = await page.request.get(
    `/api/p/vapes/reportes/compras?periodo=hoy&productoId=${productoId}&formato=xlsx`,
  );
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("spreadsheetml");
});

test("Trinidad (REPORTES ver) no accede a lo de dueños: 403 en exportaciones y sin tarjeta", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await db.permisoUsuario.upsert({
    where: {
      usuarioId_panelId_modulo: {
        usuarioId: trinidad.id,
        panelId: PANEL_VAPES,
        modulo: Modulo.REPORTES,
      },
    },
    create: {
      usuarioId: trinidad.id,
      panelId: PANEL_VAPES,
      modulo: Modulo.REPORTES,
      puedeVer: true,
    },
    update: { puedeVer: true },
  });
  try {
    await login(page, trinidad.email, PASSWORD_TRINIDAD);
    await page.goto("/p/vapes/reportes");
    await expect(page.getByTestId("reporte-ventas")).toBeVisible();
    for (const clave of ["comparador", "empresa", "vendedores", "compras", "resumen-mensual"]) {
      await expect(page.getByTestId(`reporte-${clave}`)).toHaveCount(0);
      const r = await page.request.get(`/api/p/vapes/reportes/${clave}?formato=pdf`);
      expect(r.status(), clave).toBe(403);
    }
    const ok = await page.request.get("/api/p/vapes/reportes/ventas?formato=pdf");
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("application/pdf");
    await page.goto(`/p/vapes/reportes/comparador?productoId=${productoId}`);
    await expect(page).toHaveURL(/sin-acceso/);
  } finally {
    await db.permisoUsuario.deleteMany({
      where: { usuarioId: trinidad.id, panelId: PANEL_VAPES, modulo: Modulo.REPORTES },
    });
  }
});

test("Cosmetic solo ve proveedores de Cosmetic", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const usuarioId = (await dueno()).id;
  const marca = await db.marca.create({
    data: { panelId: PANEL_COSMETIC, nombre: `Cos${sufijo}` },
  });
  const producto = await db.producto.create({
    data: {
      panelId: PANEL_COSMETIC,
      marcaId: marca.id,
      nombre: "Serum",
      precioVenta: 9000,
      variantes: { create: { panelId: PANEL_COSMETIC, nombre: "Único", sku: `E2E-R5C-${sufijo}` } },
    },
  });
  for (const [nombre, precio] of [
    ["Cosme", "5000"],
    ["Tica", "5600"],
  ] as const) {
    await db.proveedor.create({
      data: {
        panelId: PANEL_COSMETIC,
        nombre: `${nombre} ${sufijo}`,
        nombreTienda: `Tienda ${nombre}`,
        productos: {
          create: { panelId: PANEL_COSMETIC, productoId: producto.id, precio, usuarioId },
        },
      },
    });
  }
  await loginDueno(page);
  await page.goto("/p/cosmetic/reportes/comparador?vista=matriz");
  const matriz = page.getByTestId("matriz");
  await expect(matriz).toContainText(`Cosme ${sufijo}`);
  await expect(matriz).toContainText(`Tica ${sufijo}`);
  await expect(matriz).not.toContainText(`Ana ${sufijo}`);
  await expect(matriz).not.toContainText(`Comp${sufijo}`);
  // Un producto de Vapes no se puede comparar desde Cosmetic.
  await page.goto(`/p/cosmetic/reportes/comparador?productoId=${productoId}`);
  await expect(page.getByText("Ese producto no existe o fue dado de baja")).toBeVisible();
  await expect(page.getByTestId("oferta")).toHaveCount(0);
  await expect(page.getByTestId("sugerencias")).not.toContainText(`Comp${sufijo}`);
  const r = await page.request.get(
    `/api/p/cosmetic/reportes/comparador?productoId=${productoId}&formato=pdf`,
  );
  expect(r.status()).toBe(404);
});

test("el resumen mensual responde un PDF de una página", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  await loginDueno(page);
  await page.goto("/p/vapes/reportes/resumen-mensual");
  await expect(page.getByTestId("exportar-pdf")).toBeVisible();
  const href = await page.getByTestId("exportar-pdf").getAttribute("href");
  const r = await page.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toBe("application/pdf");
  const pdf = await r.body();
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(`${CARPETA}/resumen-mensual.pdf`, pdf);
});
