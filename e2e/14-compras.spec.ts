import { expect, test } from "./base";

import {
  db,
  depositoId,
  EMAIL_DUENO,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { PASSWORD_TRINIDAD } from "./global-setup";

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}

/** Un producto con dos sabores y un proveedor (Lucas) que lo vende a $ 7.000. */
async function preparar(sufijo: string) {
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const marca = await db.marca.create({ data: { panelId: PANEL_VAPES, nombre: `Comp${sufijo}` } });
  const codigos = { Mango: ean13(`778${sufijo}001`), Uva: ean13(`778${sufijo}002`) };
  const creado = await db.producto.create({
    data: {
      panelId: PANEL_VAPES,
      marcaId: marca.id,
      nombre: "Pod",
      especificacion: "6000",
      precioVenta: 14000,
      variantes: {
        create: Object.entries(codigos).map(([sabor, codigoBarras], i) => ({
          panelId: PANEL_VAPES,
          nombre: sabor,
          sku: `E2E-C${sufijo}-${i}`,
          codigoBarras,
        })),
      },
    },
  });
  const producto = await db.producto.findUniqueOrThrow({
    where: { id: creado.id },
    include: { variantes: true },
  });
  const proveedor = await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Lucas",
      nombreTienda: `Vape House ${sufijo}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: producto.id,
          precio: 7000,
          usuarioId: dueno.id,
        },
      },
    },
  });
  const variante = (sabor: string) => producto.variantes.find((v) => v.nombre === sabor)!;
  return { producto, proveedor, codigos, mango: variante("Mango"), uva: variante("Uva") };
}

test("compra a Lucas: 10 + 10 de dos sabores con costo sugerido, recibir actualizando su precio", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const { producto, proveedor, codigos, mango, uva } = await preparar(sufijo);
  const nc = producto.nombreCompleto;
  const mercedes = await depositoId("Mercedes");

  await loginDueno(page);
  await page.goto("/p/vapes/compras/nueva");
  // Paso 1: proveedor.
  await page.getByRole("radio", { name: new RegExp(`Vape House ${sufijo}`) }).click();
  // Paso 2: galpón (nunca se confirma solo).
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();
  // Paso 3: ítems con la pistola.
  await expect(page.getByText("Paso 3 de 3", { exact: false })).toBeVisible();
  await soltarFoco(page);
  await pistola(page, codigos.Mango);
  await pistola(page, codigos.Uva);

  const costoMango = page.getByLabel(`Costo de ${nc} — Mango`);
  const costoUva = page.getByLabel(`Costo de ${nc} — Uva`);
  await expect(costoMango).toHaveValue("7000");
  await expect(costoUva).toHaveValue("7000");
  await page.getByLabel(`Cantidad de ${nc} — Mango`).fill("10");
  await page.getByLabel(`Cantidad de ${nc} — Uva`).fill("10");
  await costoUva.fill("7500");

  await page.getByRole("button", { name: "Recibir mercadería" }).click();
  const dialogo = page.getByRole("dialog", { name: "Recibir mercadería" });
  await expect(dialogo.getByText("¿Actualizar el precio de Lucas con estos costos?")).toBeVisible();
  await expect(dialogo.getByRole("list", { name: "Precios que cambian" })).toContainText(
    /de \$\s*7\.000 a \$\s*7\.500/,
  );
  await dialogo.getByRole("button", { name: "Sí, recibir y actualizar" }).click();
  await page.waitForURL((u) => /^\/p\/vapes\/compras\/[a-z0-9]+$/.test(u.pathname));
  await expect(page.getByText("Recibida", { exact: true })).toBeVisible();

  const compra = await db.compra.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, proveedorId: proveedor.id },
    include: { items: true },
  });
  expect(compra).toMatchObject({ estado: "RECIBIDA", depositoId: mercedes });
  expect(compra.total.toFixed(0)).toBe("145000");
  expect(compra.items.every((i) => i.productoId === producto.id)).toBe(true);

  const movimientos = await db.movimientoStock.findMany({
    where: { referenciaTipo: "COMPRA", referenciaId: compra.id },
  });
  expect(movimientos).toHaveLength(2);
  for (const m of movimientos) {
    expect(m).toMatchObject({ tipo: "INGRESO_COMPRA", depositoId: mercedes, cantidad: 10 });
  }

  const [mangoDespues, uvaDespues] = await Promise.all([
    db.variante.findUniqueOrThrow({ where: { id: mango.id } }),
    db.variante.findUniqueOrThrow({ where: { id: uva.id } }),
  ]);
  expect(mangoDespues.ultimoCosto?.toFixed(0)).toBe("7000");
  expect(uvaDespues.ultimoCosto?.toFixed(0)).toBe("7500");

  // Precio por producto: gana el costo del último ítem cargado (Uva, $ 7.500).
  const precio = await db.proveedorProducto.findFirstOrThrow({
    where: { proveedorId: proveedor.id, productoId: producto.id },
  });
  expect(precio.precio.toFixed(0)).toBe("7500");

  // Link a los movimientos que generó.
  await expect(page.getByRole("link", { name: /movimientos de stock/ })).toHaveAttribute(
    "href",
    `/p/vapes/stock/movimientos?referenciaTipo=COMPRA&referenciaId=${compra.id}`,
  );
});

test("Trinidad (sin COMPRAS) no puede entrar a Compras", async ({ page }) => {
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes/compras");
  await expect(page).toHaveURL(/sin-acceso/);
  await page.goto("/p/vapes/compras/nueva");
  await expect(page).toHaveURL(/sin-acceso/);
  const nav = page.locator('aside, nav[aria-label="Navegación inferior"]');
  await expect(nav.locator('a[href^="/p/vapes/compras"]')).toHaveCount(0);
});
