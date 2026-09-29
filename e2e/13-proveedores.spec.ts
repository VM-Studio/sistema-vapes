import { expect, test } from "./base";

import { db, loginDueno, PANEL_VAPES } from "./helpers";
import { limpiarAlTerminar } from "./fixtures";

limpiarAlTerminar();

/** 3 productos propios del test (sin sabores: una variante "Único" cada uno). */
async function crearProductos(sufijo: string) {
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `Prov${sufijo}` } });
  const modelos = ["Alfa", "Beta", "Gama"];
  const productos = [];
  for (const [i, modelo] of modelos.entries()) {
    productos.push(
      await db.producto.create({
        data: {
          panelId: PANEL_VAPES,
          marcaId: marca.id,
          nombre: modelo,
          especificacion: "5000",
          precioVenta: 15000,
          variantes: {
            create: { panelId: PANEL_VAPES, nombre: "Único", sku: `E2E-P${sufijo}-${i}` },
          },
        },
      }),
    );
  }
  // nombreCompleto lo completa el trigger de la DB.
  return db.producto.findMany({
    where: { id: { in: productos.map((p) => p.id) } },
    orderBy: { nombre: "asc" },
  });
}

test("crear a Lucas (Vape House) con 3 productos y precios → tarjeta con acordeón de productos", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const productos = await crearProductos(sufijo);
  const precios = ["7000", "8200", "9150"];
  const enPesos = [/\$\s*7\.000/, /\$\s*8\.200/, /\$\s*9\.150/];
  const telefono = `11${sufijo}55`;

  await loginDueno(page);
  await page.goto("/p/vapes/proveedores");
  await page.getByRole("button", { name: "Nuevo proveedor" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Nombre", exact: true }).fill("Lucas");
  await sheet.getByRole("textbox", { name: "Teléfono" }).fill(telefono);
  await sheet.getByRole("textbox", { name: "Nombre de la tienda" }).fill("Vape House");
  for (const [i, p] of productos.entries()) {
    await sheet.getByRole("combobox", { name: "Agregar producto que vende" }).fill(p.nombre);
    await sheet.getByRole("option", { name: p.nombreCompleto }).click();
    await sheet.getByLabel(`Precio de ${p.nombreCompleto}`).fill(precios[i]!);
  }
  await sheet.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Proveedor creado")).toBeVisible();

  // Puede haber otros "Lucas · Vape House" de corridas anteriores: la tarjeta es la de SU teléfono.
  const tarjeta = page
    .getByRole("listitem", { name: "Lucas · Vape House" })
    .filter({ has: page.locator(`a[href="https://wa.me/54${telefono}"]`) });
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta.getByRole("link", { name: "WhatsApp a Lucas" })).toHaveAttribute(
    "href",
    `https://wa.me/54${telefono}`,
  );
  await tarjeta.getByRole("button", { name: "Ver productos (3)" }).click();
  const lista = tarjeta.getByRole("list", { name: "Productos de Lucas" });
  await expect(lista.getByRole("listitem")).toHaveCount(3);
  for (const [i, p] of productos.entries()) {
    const fila = lista.getByRole("listitem").filter({ hasText: p.nombreCompleto });
    await expect(fila).toContainText(enPesos[i]!);
  }

  const proveedor = await db.proveedor.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, telefono: `+54${telefono}` },
    include: { productos: true },
  });
  expect(proveedor).toMatchObject({ nombre: "Lucas", nombreTienda: "Vape House" });
  expect(proveedor.productos.map((pp) => pp.precio.toFixed(0)).sort()).toEqual(precios);
});
