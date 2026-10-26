import { expect, test } from "./base";

import { db, EMAIL_DUENO, loginDueno, PANEL_VAPES, pistola } from "./helpers";
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

test("crear a Lucas (Vape House) con 3 productos (2 en pesos y 1 en USDT) → tarjeta con acordeón y equivalente en pesos", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const productos = await crearProductos(sufijo);
  // Los dos primeros en pesos; el tercero en USDT (la moneda por defecto): 150 USDT × 1.350 (cotización del setup).
  const precios = ["7000", "8200", "150"];
  const enPesos = [/\$\s*7\.000/, /\$\s*8\.200/, /150 USDT/];
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
    if (i < 2) await sheet.getByLabel(`Moneda de ${p.nombreCompleto}`).selectOption("ARS");
  }
  // En vivo, en gris: el equivalente en pesos del precio en USDT.
  await expect(sheet.getByTestId("equivalente-usdt")).toHaveText("≈ $ 202.500");
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
  await expect(
    lista.getByRole("listitem").filter({ hasText: productos[2]!.nombreCompleto }),
  ).toContainText("≈ $ 202.500");

  const proveedor = await db.proveedor.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, telefono: `+54${telefono}` },
    include: { productos: true },
  });
  expect(proveedor).toMatchObject({ nombre: "Lucas", nombreTienda: "Vape House" });
  expect(proveedor.productos.map((pp) => pp.precio.toFixed(0)).sort()).toEqual([...precios].sort());
  expect(proveedor.productos.find((pp) => pp.precio.toFixed(0) === "150")?.moneda).toBe("USDT");
});

function ean13(base12: string) {
  const suma = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (suma % 10)) % 10);
}

test("vincular productos a un proveedor escaneando: nuevo, ya vinculado (código alternativo) y desconocido", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const [alfa, beta] = await crearProductos(sufijo);
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const codigoBeta = ean13(`779${sufijo}101`);
  const alternativoAlfa = ean13(`779${sufijo}202`);
  const varianteDe = (productoId: string) =>
    db.variante.findFirstOrThrow({ where: { productoId } });
  await db.variante.update({
    where: { id: (await varianteDe(beta!.id)).id },
    data: { codigoBarras: codigoBeta },
  });
  await db.codigoBarrasAlternativo.create({
    data: {
      panelId: PANEL_VAPES,
      varianteId: (await varianteDe(alfa!.id)).id,
      codigo: alternativoAlfa,
    },
  });
  const proveedor = await db.proveedor.create({
    data: {
      panelId: PANEL_VAPES,
      nombre: "Escaneo",
      nombreTienda: `Escaneo ${sufijo}`,
      productos: {
        create: {
          panelId: PANEL_VAPES,
          productoId: alfa!.id,
          precio: 5,
          moneda: "USDT",
          usuarioId: dueno.id,
        },
      },
    },
  });

  await loginDueno(page);
  await page.goto(`/p/vapes/proveedores/${proveedor.id}`);
  await page.waitForLoadState("networkidle");
  // El campo «Escanear código» tiene el foco listo para la pistola.
  await expect(page.getByLabel("Código de barras")).toBeFocused();

  // Producto nuevo: se agrega y el foco pasa a su precio.
  await pistola(page, codigoBeta);
  const precioBeta = page.getByRole("textbox", {
    name: `Precio de ${beta!.nombreCompleto}`,
    exact: true,
  });
  await expect(precioBeta).toBeFocused();
  await expect(page.getByTestId("resultado-escaneo-proveedor")).toContainText("agregado");
  await page.getByLabel(`Moneda de ${beta!.nombreCompleto}`).selectOption("ARS");
  await precioBeta.fill("7000");
  await precioBeta.press("Enter");
  await expect
    .poll(async () =>
      (
        await db.proveedorProducto.findFirst({
          where: { proveedorId: proveedor.id, productoId: beta!.id },
        })
      )?.precio.toFixed(0),
    )
    .toBe("7000");

  // Ya vinculado (por su código alternativo): abre su precio para editarlo.
  await pistola(page, alternativoAlfa);
  await expect(
    page.getByRole("textbox", { name: `Precio de ${alfa!.nombreCompleto}`, exact: true }),
  ).toBeFocused();
  await expect(page.getByTestId("resultado-escaneo-proveedor")).toContainText("ya está vinculado");

  // Código desconocido: mensaje claro, no agrega nada.
  await pistola(page, ean13(`779${sufijo}999`));
  await expect(page.getByTestId("resultado-escaneo-proveedor")).toContainText(
    "No hay ningún producto con el código",
  );
  await expect(
    page.getByRole("list", { name: "Productos del proveedor" }).locator("> li"),
  ).toHaveCount(2);
});
