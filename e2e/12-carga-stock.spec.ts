import { expect, test } from "./base";

import { Modulo } from "@prisma/client";

import {
  codigoDe,
  crearUsuario,
  db,
  depositoId,
  ELF_BAR_BC5000,
  esMobile,
  llamarAccion,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
  stock,
} from "./helpers";

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}
const sufijo = () => String(Date.now()).slice(-7);

const SIN_GALPON = "Tenés que elegir el galpón antes de cargar stock";

test("sin elegir galpón no se carga nada (ni escaneando ni llamando a la acción)", async ({
  page,
}) => {
  const codigo = await codigoDe(ELF_BAR_BC5000, "Cool Mint");
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigoBarras: codigo },
  });
  await loginDueno(page);
  await page.goto("/p/vapes/productos/cargar");
  await expect(page.getByRole("heading", { name: "¿En qué galpón vas a cargar?" })).toBeVisible();
  await soltarFoco(page);
  await pistola(page, codigo);
  await pistola(page, "7799999999994");
  // Nada entró a una lista ni abrió el alta rápida: sigue el paso del galpón.
  await expect(page.getByRole("list", { name: "Lista de carga" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Producto nuevo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Cargar \d+ unidad/ })).toHaveCount(0);

  const antes = await db.movimientoStock.count({ where: { panelId: PANEL_VAPES } });
  const items = [{ varianteId: variante.id, cantidad: 1 }];
  const sinDeposito = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { items },
    "/p/vapes/productos/cargar",
  );
  expect(sinDeposito).toContain(SIN_GALPON);
  const invalido = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { depositoId: "dep_cosmetic_principal", items },
    "/p/vapes/productos/cargar",
  );
  expect(invalido).toContain(SIN_GALPON);
  expect(await db.movimientoStock.count({ where: { panelId: PANEL_VAPES } })).toBe(antes);
});

test("Mercedes: 5 códigos (2 desconocidos por alta rápida) → 5 INGRESO_MANUAL y stock por galpón", async ({
  page,
}) => {
  const conocidos = await Promise.all(
    ["Cool Mint", "Peach Mango", "Watermelon Ice"].map((s) => codigoDe(ELF_BAR_BC5000, s)),
  );
  const n = sufijo();
  const nuevoMango = ean13(`77980${n}`);
  const nuevoFrutilla = ean13(`77981${n}`);
  const mercedes = await depositoId("Mercedes");
  const desde = new Date();

  await loginDueno(page);
  await page.goto("/p/vapes/productos/cargar");
  await page.getByRole("radio", { name: /Mercedes/ }).click();
  await page.getByRole("button", { name: "Continuar con Mercedes" }).click();
  await expect(page.getByTestId("galpon-actual")).toHaveText("Mercedes");
  await soltarFoco(page);
  for (const c of conocidos) await pistola(page, c);
  await expect(
    page.getByRole("list", { name: "Lista de carga" }).getByRole("listitem"),
  ).toHaveCount(3);

  // Desconocido 1: alta rápida detecta Elf Bar BC 5000 y solo pide el sabor.
  await pistola(page, nuevoMango);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Producto nuevo" })).toBeVisible();
  await expect(sheet.getByText(nuevoMango)).toBeVisible();
  await sheet.getByLabel("Marca").fill("Elf Bar");
  await sheet.getByLabel("Modelo").fill("BC");
  await sheet.getByLabel("Pitadas").fill("5000");
  await expect(sheet.getByText(`Ya existe ${ELF_BAR_BC5000}`)).toBeVisible();
  await sheet.getByLabel("Sabor", { exact: true }).fill("Mango");
  await sheet.getByRole("button", { name: "Guardar y agregar" }).click();
  await expect(page.getByLabel(`Cantidad de ${ELF_BAR_BC5000} — Mango`)).toHaveValue("1");

  // El escáner sigue activo: desconocido 2 agrega "Frutilla" al mismo producto.
  await soltarFoco(page);
  await pistola(page, nuevoFrutilla);
  await expect(sheet.getByRole("heading", { name: "Producto nuevo" })).toBeVisible();
  await sheet.getByLabel("Marca").fill("Elf Bar");
  await sheet.getByLabel("Modelo").fill("BC");
  await sheet.getByLabel("Pitadas").fill("5000");
  await expect(sheet.getByText(`Ya existe ${ELF_BAR_BC5000}`)).toBeVisible();
  await sheet.getByLabel("Sabor", { exact: true }).fill("Frutilla");
  await sheet.getByRole("button", { name: "Guardar y agregar" }).click();
  await expect(page.getByLabel(`Cantidad de ${ELF_BAR_BC5000} — Frutilla`)).toHaveValue("1");

  await page.getByRole("button", { name: "Cargar 5 unidades en Mercedes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar carga" }).click();
  await expect(page.getByText("Cargaste 5 unidades en Mercedes")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cargar más" })).toBeVisible();

  const movs = await db.movimientoStock.findMany({
    where: { panelId: PANEL_VAPES, createdAt: { gte: desde }, tipo: "INGRESO_MANUAL" },
  });
  expect(movs).toHaveLength(5);
  expect(movs.every((m) => m.depositoId === mercedes && m.cantidad === 1)).toBe(true);

  const producto = await db.producto.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombreCompleto: ELF_BAR_BC5000 },
    include: { variantes: { where: { deletedAt: null } } },
  });
  expect(producto.variantes.map((v) => v.nombre)).toEqual(
    expect.arrayContaining(["Mango", "Frutilla"]),
  );

  if (!esMobile(page)) {
    await page.goto(`/p/vapes/productos?q=${encodeURIComponent(ELF_BAR_BC5000)}`);
    await page.getByRole("button", { name: `Ver sabores de ${ELF_BAR_BC5000}` }).click();
    for (const sabor of ["Mango", "Frutilla"]) {
      const enMercedes = await stock(ELF_BAR_BC5000, sabor, "Mercedes");
      const enAyres = await stock(ELF_BAR_BC5000, sabor, "Ayres Plaza");
      expect(enAyres).toBe(0);
      expect(enMercedes).toBeGreaterThanOrEqual(1);
      const fila = page.getByRole("row", { name: sabor, exact: true });
      await expect(fila.locator('[data-deposito="Ayres Plaza"]')).toHaveText("0");
      await expect(fila.locator('[data-deposito="Mercedes"]')).toHaveText(String(enMercedes));
      await expect(fila.locator('[data-deposito="Total"]')).toHaveText(String(enMercedes));
    }
  }
});

test("el mismo EAN en Cosmetic no se reconoce: ofrece alta rápida", async ({ page }) => {
  const codigo = await codigoDe(ELF_BAR_BC5000, "Cool Mint");
  await loginDueno(page);
  await page.goto("/p/cosmetic/productos/cargar");
  await page.getByRole("radio", { name: /Principal/ }).click();
  await page.getByRole("button", { name: "Continuar con Principal" }).click();
  await soltarFoco(page);
  await pistola(page, codigo);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Producto nuevo" })).toBeVisible();
  await expect(sheet.getByText(codigo)).toBeVisible();
  await expect(sheet.getByText("no está cargado en Cosmetic")).toBeVisible();
  await expect(page.getByRole("list", { name: "Lista de carga" })).toHaveCount(0);
});

test("precio efectivo: producto a $10.000 y un sabor con precio propio de $12.000", async ({
  page,
}) => {
  const n = sufijo();
  const codigoProducto = ean13(`77982${n}`);
  const codigoPropio = ean13(`77983${n}`);
  const clave = { marca: "Elf Bar", modelo: `Precio ${n}`, especificacion: "3000" };
  await loginDueno(page);
  await page.goto("/p/vapes/productos");
  const ruta = "/p/vapes/productos/cargar";

  const alta1 = await llamarAccion(
    page,
    "altaRapidaAction",
    { ...clave, codigoBarras: codigoProducto, sabor: "Uva", precioVenta: "10000" },
    ruta,
  );
  expect(alta1).toContain('"ok":true');
  const alta2 = await llamarAccion(
    page,
    "altaRapidaAction",
    { ...clave, codigoBarras: codigoPropio, sabor: "Pera", precioVentaSabor: "12000" },
    ruta,
  );
  expect(alta2).toContain('"ok":true');

  const delProducto = await llamarAccion(
    page,
    "resolverCodigoAction",
    { codigo: codigoProducto },
    ruta,
  );
  expect(delProducto).toContain('"precioVenta":"10000.00"');
  expect(delProducto).toContain('"tienePrecioPropio":false');
  const propio = await llamarAccion(page, "resolverCodigoAction", { codigo: codigoPropio }, ruta);
  expect(propio).toContain('"precioVenta":"12000.00"');
  expect(propio).toContain('"precioVentaProducto":"10000.00"');
  expect(propio).toContain('"tienePrecioPropio":true');

  const variantes = await db.variante.findMany({
    where: { panelId: PANEL_VAPES, codigoBarras: { in: [codigoProducto, codigoPropio] } },
    include: { producto: true },
  });
  expect(new Set(variantes.map((v) => v.productoId)).size).toBe(1);
  expect(variantes[0]!.producto.precioVenta.toFixed(2)).toBe("10000.00");
});

test("quien solo ve Productos no puede cargar: sin botón y la acción responde Forbidden", async ({
  page,
}) => {
  const u = await crearUsuario({ permisos: [{ modulo: Modulo.PRODUCTOS, ver: true }] });
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigoBarras: await codigoDe(ELF_BAR_BC5000, "Cool Mint") },
  });
  await login(page, u.email, u.password);
  await page.goto("/p/vapes/productos");
  await expect(page.getByRole("heading", { name: "Productos" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cargar stock/ })).toHaveCount(0);
  const r = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { depositoId: await depositoId("Mercedes"), items: [{ varianteId: variante.id, cantidad: 1 }] },
    "/p/vapes/productos",
  );
  expect(r).toContain('"code":"FORBIDDEN"');
});
