import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./base";

import {
  db,
  depositoId,
  EMAIL_DUENO,
  esMobile,
  login,
  loginDueno,
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
          moneda: "ARS",
          usuarioId: dueno.id,
        },
      },
    },
  });
  const variante = (sabor: string) => producto.variantes.find((v) => v.nombre === sabor)!;
  return { producto, proveedor, codigos, mango: variante("Mango"), uva: variante("Uva") };
}

test("compra a Lucas: 10 + 10 de dos sabores, Confirmar (sin stock) y después Recibido actualizando su precio", async ({
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

  // Resumen grande y costo final por unidad, en vivo.
  await expect(page.getByLabel("Costo final total", { exact: true })).toContainText(/145\.000/);
  await expect(page.getByTestId("fila-costo-final")).toHaveCount(2);

  // «Confirmar»: la compra queda pendiente de recibir y NO suma stock.
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/p\/vapes\/compras\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nueva"),
  );
  await expect(page.getByText("Pendiente de recibir", { exact: true }).first()).toBeVisible();
  const pendiente = await db.compra.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, proveedorId: proveedor.id },
  });
  expect(pendiente.estado).toBe("BORRADOR");
  expect(
    await db.movimientoStock.count({
      where: { referenciaTipo: "COMPRA", referenciaId: pendiente.id },
    }),
  ).toBe(0);

  // «Recibido» (con confirmación): recién ahí entra el stock.
  await page.getByRole("button", { name: /^Recibido/ }).click();
  const dialogo = page.getByRole("dialog", { name: "¿Llegó la mercadería?" });
  await expect(dialogo.getByText("¿Actualizar el precio de Lucas con estos costos?")).toBeVisible();
  await expect(dialogo.getByRole("list", { name: "Precios que cambian" })).toContainText(
    /de \$\s*7\.000 a \$\s*7\.500/,
  );
  await dialogo.getByRole("button", { name: "Recibido y actualizar precios" }).click();
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

test("catálogo del proveedor y comparador: agregar sabores con su precio y pasarle la compra al más barato", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const { producto, proveedor: lucas, mango, uva } = await preparar(sufijo);
  const nc = producto.nombreCompleto;
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  // Ana lo vende en USDT: 5 × $ 1.350 (cotización fija del e2e) = $ 6.750, más barato que Lucas.
  const ana = await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Ana",
      nombreTienda: `Mayorista Ana ${sufijo}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: producto.id,
          precio: 5,
          moneda: "USDT",
          usuarioId: dueno.id,
        },
      },
    },
  });

  await loginDueno(page);
  await page.goto("/p/vapes/compras/nueva");
  await page.getByRole("radio", { name: new RegExp(`Vape House ${sufijo}`) }).click();
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();

  // Paso 3: el catálogo de Lucas con su precio.
  const catalogo = page.getByRole("list", { name: "Productos de Lucas" });
  const fila = catalogo.getByRole("button", { name: `Agregar ${nc}` });
  await expect(fila).toContainText(/\$\s*7\.000/);
  await captura(page, "bloqueA-catalogo", catalogo);
  await fila.click();

  // Hoja del producto: sabores con cantidad y costo precargado; quién lo vende.
  const hoja = page.getByRole("dialog", { name: nc });
  await expect(hoja.getByLabel("Costo unitario")).toHaveValue("7000");
  const ofertas = hoja
    .getByRole("list", { name: "Proveedores que lo venden" })
    .getByTestId("oferta-compra");
  await expect(ofertas).toHaveCount(2);
  await expect(ofertas.nth(0)).toHaveAttribute("data-proveedor", "Ana");
  await expect(ofertas.nth(0)).toContainText("Más barato");
  await expect(ofertas.nth(0)).toContainText(/≈ \$\s*6\.750/);
  await expect(ofertas.nth(1)).toContainText("Proveedor de esta compra");
  await hoja.getByLabel("Cantidad a agregar de Mango").fill("3");
  await hoja.getByLabel("Cantidad a agregar de Uva").fill("2");
  await captura(page, "bloqueA-hoja-producto");
  await hoja.getByRole("button", { name: /Agregar 5 u\./ }).click();
  await expect(hoja).toBeHidden();

  await expect(page.getByLabel(`Cantidad de ${nc} — Mango`)).toHaveValue("3");
  await expect(page.getByLabel(`Cantidad de ${nc} — Uva`)).toHaveValue("2");
  await expect(page.getByLabel(`Costo de ${nc} — Mango`)).toHaveValue("7000");
  // Pista en el ítem: Ana lo vende más barato.
  const pista = page.getByTestId("pista-comparador");
  await expect(pista).toContainText("Más barato con Ana");
  await expect(pista).toContainText(/ahorrás \$\s*250/);
  await captura(page, "bloqueA-items-pista", page.getByTestId("pista-comparador"));

  // La compra solo tiene este producto: se la paso a Ana desde el comparador.
  await pista.getByRole("button", { name: "Comparar 2 proveedores" }).click();
  await hoja.getByRole("button", { name: "Comprarle a Ana" }).click();
  await hoja.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByText(`Ana · Mayorista Ana ${sufijo}`)).toBeVisible();
  // Los costos sugeridos pasan al precio de Ana (5 USDT × $ 1.350).
  await expect(page.getByLabel(`Costo de ${nc} — Mango`)).toHaveValue("6750");
  await expect(page.getByLabel(`Costo de ${nc} — Uva`)).toHaveValue("6750");
  await expect(page.getByTestId("pista-comparador")).toContainText("Ana es el más barato");
  await expect(page.getByRole("list", { name: "Productos de Ana" })).toBeVisible();
  await captura(page, "bloqueA-cambio-proveedor", page.getByTestId("pista-comparador"));

  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/p\/vapes\/compras\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nueva"),
  );
  const compra = await db.compra.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, proveedorId: ana.id },
    include: { items: true },
  });
  expect(compra.estado).toBe("BORRADOR");
  expect(
    compra.items.map((i) => [i.varianteId, i.cantidad, i.costoUnitario.toFixed(0)]).sort(),
  ).toEqual(
    [
      [mango.id, 3, "6750"],
      [uva.id, 2, "6750"],
    ].sort(),
  );
  expect(await db.compra.count({ where: { proveedorId: lucas.id } })).toBe(0);
});
