import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { db, EMAIL_DUENO, loginDueno, PANEL_VAPES, pistola, soltarFoco } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * v2.11.0:
 *  1. Vender la última unidad de un sabor → aviso «Se vendió la última unidad» con «OK».
 *  2. Productos sin código de barras: «Vincular» + escanear → el código le queda al sabor.
 *  3. Ventas: arriba pesos (grande) y abajo USDT (chico).
 *  4. Compra: «Agregar sabor» desde la hoja del producto, sin salir de la compra.
 */
test.describe.configure({ mode: "serial" });

const suf = () => String(Date.now()).slice(-6);
const modal = (page: Page) => page.getByTestId("modal-venta");

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}

test("vender la última unidad muestra el aviso y se cierra con OK", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  // Un sabor con pocas unidades en Ayres Plaza: se venden todas.
  const s = await db.stock.findFirstOrThrow({
    where: {
      panelId: PANEL_VAPES,
      deposito: { nombre: "Ayres Plaza" },
      cantidad: { gte: 1, lte: 30 },
      variante: {
        codigoBarras: { not: null },
        activo: true,
        deletedAt: null,
        ultimoCostoUsdt: { not: null },
        producto: { activo: true, deletedAt: null },
      },
    },
    include: { variante: { include: { producto: true } } },
    orderBy: { cantidad: "asc" },
  });
  const titulo = `${s.variante.producto.nombreCompleto} — ${s.variante.nombre}`;

  await loginDueno(page);
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await modal(page)
    .getByRole("radio", { name: /Ayres Plaza/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await expect(modal(page).getByTestId("galpon-venta")).toContainText("Ayres Plaza");
  await soltarFoco(page);
  await pistola(page, s.variante.codigoBarras!);
  const cantidad = modal(page).getByLabel(`Cantidad de ${titulo}`);
  await expect(cantidad).toHaveValue("1");
  await cantidad.fill(String(s.cantidad));
  await cantidad.blur();
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill("Última");
  await modal(page)
    .getByLabel("Teléfono")
    .fill(`11 5${suf().slice(0, 3)} ${suf().slice(-4)}`);
  await modal(page)
    .getByLabel(/De quién viene/)
    .selectOption({ label: "Juan Cruz" });
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("radio", { name: "Efectivo" }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  await expect(modal(page).getByTestId("id-venta")).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });

  const aviso = page.getByRole("dialog", { name: "Se vendió la última unidad" });
  await expect(aviso).toBeVisible();
  await expect(aviso.getByTestId("ultima-unidad")).toContainText(titulo);
  await aviso.getByRole("button", { name: "OK" }).click();
  await expect(aviso).toBeHidden();
  // La venta exitosa sigue a la vista.
  await expect(modal(page).getByTestId("id-venta")).toBeVisible();
  const despues = await db.stock.findUniqueOrThrow({ where: { id: s.id } });
  expect(despues.cantidad).toBe(0);
});

test("ventas: arriba pesos en grande y abajo USDT", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/vapes/ventas?rango=todo");
  const totales = page.getByRole("region", { name: "Totales del período" });
  await expect(totales).toContainText("Total vendido");
  await expect(totales).toContainText(/USDT/);
  // El número grande (el primero después de la etiqueta) es en pesos; abajo, USDT.
  const texto = (await totales.innerText()).replace(/\s+/g, " ");
  const despuesDeEtiqueta = texto.slice(texto.indexOf("Total vendido") + "Total vendido".length);
  expect(despuesDeEtiqueta.trim()).toMatch(/^\$/);
  expect(despuesDeEtiqueta.indexOf("$")).toBeLessThan(despuesDeEtiqueta.indexOf("USDT"));
});

test("productos sin código: Vincular y escanear le deja el código", async ({ page }) => {
  const s = suf();
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `SinCod${s}` } });
  const producto = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Pod",
      especificacion: "7000",
      precioVenta: 10000,
      variantes: {
        create: [{ panelId: PANEL_VAPES, nombre: "Kiwi", sku: `E2E-SC${s}` }],
      },
    },
    include: { variantes: true },
  });
  const variante = producto.variantes[0]!;
  const codigo = ean13(`779${s}123`);

  await loginDueno(page);
  await page.goto("/p/vapes/productos");
  await page.getByTestId("link-sin-codigo").click();
  await expect(page).toHaveURL(/\/productos\/sin-codigo$/);
  const fila = page.getByTestId("sabor-sin-codigo").filter({ hasText: `${marca.nombre}` });
  await expect(fila).toHaveCount(1);
  await fila.getByTestId("vincular").click();
  await soltarFoco(page);
  await pistola(page, codigo);
  await expect(fila).toContainText(codigo);
  const v = await db.variante.findUniqueOrThrow({ where: { id: variante.id } });
  expect(v.codigoBarras).toBe(codigo);

  // Un código que ya es de otro sabor se rechaza.
  const otra = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Pod2",
      especificacion: "7000",
      precioVenta: 10000,
      variantes: { create: [{ panelId: PANEL_VAPES, nombre: "Pera", sku: `E2E-SD${s}` }] },
    },
  });
  await page.reload();
  const filaPera = page.getByTestId("sabor-sin-codigo").filter({ hasText: "Pera" });
  await filaPera.getByTestId("vincular").click();
  await soltarFoco(page);
  await pistola(page, codigo);
  await expect(filaPera.getByTestId("error-vincular")).toContainText("ya pertenece");
  const pera = await db.variante.findFirstOrThrow({ where: { productoId: otra.id } });
  expect(pera.codigoBarras).toBeNull();
});

test("compra: «Agregar sabor» desde la hoja del producto y comprarlo sin salir", async ({
  page,
}) => {
  const s = suf();
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `Sab${s}` } });
  const creado = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Pod",
      especificacion: "30000",
      precioVenta: 15000,
      variantes: {
        create: [
          {
            panelId: PANEL_VAPES,
            nombre: "Mango",
            sku: `E2E-AS${s}`,
            codigoBarras: ean13(`778${s}001`),
          },
        ],
      },
    },
  });
  const producto = await db.producto.findUniqueOrThrow({ where: { id: creado.id } });
  await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Liz",
      nombreTienda: `Total Shop ${s}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: producto.id,
          precio: 9,
          moneda: "USDT",
          usuarioId: dueno.id,
        },
      },
    },
  });
  const nc = producto.nombreCompleto;
  const codigoNuevo = ean13(`778${s}002`);

  await loginDueno(page);
  await page.goto("/p/vapes/compras/nueva");
  await page.getByRole("radio", { name: new RegExp(`Total Shop ${s}`) }).click();
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();
  await page
    .getByRole("list", { name: "Productos de Liz" })
    .getByRole("button", { name: `Agregar ${nc}` })
    .click();

  const hoja = page.getByRole("dialog", { name: nc });
  await expect(hoja.getByLabel("Costo unitario")).toHaveValue("9");
  await hoja.getByTestId("agregar-sabor").click();
  const form = hoja.getByTestId("form-agregar-sabor");
  await form.getByLabel("Sabor", { exact: true }).fill("Blueberry Ice");
  // La pistola completa el código aunque el foco esté en otro campo.
  await pistola(page, codigoNuevo);
  await expect(form.getByLabel("Código de barras")).toHaveValue(codigoNuevo);
  await expect(form.getByLabel("Sabor", { exact: true })).toHaveValue("Blueberry Ice");
  await form.getByLabel("Cantidad a comprar del sabor nuevo").fill("4");
  await form.getByTestId("guardar-sabor").click();

  // Queda en la lista con la cantidad y el form listo para el siguiente.
  await expect(hoja.getByLabel("Cantidad a agregar de Blueberry Ice")).toHaveValue("4");
  await expect(form.getByLabel("Sabor", { exact: true })).toHaveValue("");
  const v = await db.variante.findFirstOrThrow({
    where: { productoId: producto.id, nombre: "Blueberry Ice" },
  });
  expect(v.codigoBarras).toBe(codigoNuevo);
  expect(v.activo).toBe(true);
  const depositos = await db.deposito.count({ where: { panelId: PANEL_VAPES } });
  expect(await db.stock.count({ where: { varianteId: v.id } })).toBe(depositos);

  // Sabor repetido: error en el campo, sin crear nada.
  await form.getByLabel("Sabor", { exact: true }).fill("mango");
  await form.getByTestId("guardar-sabor").click();
  await expect(form).toContainText("ya tiene el sabor");
  expect(await db.variante.count({ where: { productoId: producto.id } })).toBe(2);
  await form.getByRole("button", { name: "Listo" }).click();

  await hoja.getByRole("button", { name: /Agregar 4 u\./ }).click();
  await expect(hoja).toBeHidden();
  await expect(page.getByLabel(`Cantidad de ${nc} — Blueberry Ice`)).toHaveValue("4");
  await expect(page.getByLabel(`Costo en USDT de ${nc} — Blueberry Ice`)).toHaveValue("9");
});
