import { expect, test } from "./base";

import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, ELF_BAR_BC5000, llamarAccion, login } from "./helpers";

/**
 * Trinidad (Vapes: ver en PRODUCTOS y STOCK): ve productos y stock, pero no
 * los costos; no puede cargar stock ni entrar a Compras.
 */
test("Trinidad ve productos y stock sin costos, no carga stock ni entra a Compras", async ({
  page,
}) => {
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);

  // Productos: los ve, sin el botón de carga.
  await page.goto("/p/vapes/productos");
  await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
  // Escritorio: nombre completo en la tabla; celular: marca en chip + "BC 5000" en la card.
  await expect(
    page
      .getByText(/BC 5000/)
      .locator("visible=true")
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Cargar stock/ })).toHaveCount(0);

  // Ficha: sin último costo ni proveedores (precios de compra).
  const producto = await db.producto.findFirstOrThrow({
    where: { panelId: "pnl_vapes", nombreCompleto: ELF_BAR_BC5000 },
  });
  await page.goto(`/p/vapes/productos/${producto.id}`);
  await expect(page.getByText(/último costo/i)).toHaveCount(0);
  await expect(page.getByText("Proveedores que lo venden")).toHaveCount(0);

  // Stock: lo ve.
  await page.goto("/p/vapes/stock");
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible();

  // Carga de stock: ni la página ni la acción.
  await page.goto("/p/vapes/productos/cargar");
  await expect(page).toHaveURL(/\/sin-acceso$/);
  const variante = await db.variante.findFirstOrThrow({ where: { productoId: producto.id } });
  const deposito = await db.deposito.findFirstOrThrow({
    where: { panelId: "pnl_vapes", nombre: "Mercedes" },
  });
  const r = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { depositoId: deposito.id, items: [{ varianteId: variante.id, cantidad: 1 }] },
    "/p/vapes/productos",
  );
  expect(r).toContain("FORBIDDEN");

  // Compras: sin acceso.
  await page.goto("/p/vapes/compras");
  await expect(page).toHaveURL(/\/sin-acceso$/);
});
