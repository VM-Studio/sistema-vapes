import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  CARGADOR,
  codigoDe,
  db,
  depositoId,
  IGNITE_V80,
  llamarAccion,
  login,
  loginDueno,
  PANEL_COSMETIC,
  PANEL_VAPES,
  pistola,
  soltarFoco,
  stock,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Ventas desde el modal "Generar venta" (galpón → productos → cliente → pago → éxito)
 * y las reglas del servidor que lo respaldan.
 */
test.describe.configure({ mode: "serial" });

const sufijo = () => `${Date.now()}`.slice(-4) + `${Math.floor(Math.random() * 9000) + 1000}`;
/** Teléfono único por corrida: "11 5### ####". */
const telefonoNico = `11 5${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`;
const normalizado = `+54${telefonoNico.replace(/\D/g, "")}`;

const modal = (page: Page) => page.getByTestId("modal-venta");

async function abrirModal(page: Page, panel = "vapes") {
  await page.goto(`/p/${panel}/ventas`);
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
}

async function elegirGalpon(page: Page, nombre: string) {
  await modal(page)
    .getByRole("radio", { name: new RegExp(nombre) })
    .click();
  await modal(page)
    .getByRole("button", { name: `Continuar con ${nombre}` })
    .click();
  await expect(modal(page).getByTestId("galpon-venta")).toContainText(nombre);
  await soltarFoco(page);
}

async function clienteNuevo(page: Page, nombre: string, telefono: string) {
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill(nombre);
  await modal(page).getByLabel("Teléfono").fill(telefono);
}

const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });

async function confirmar(page: Page, medio: "Efectivo" | "Transferencia" | "Binance") {
  await modal(page).getByRole("radio", { name: medio }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^[A-Z]{3}-\d{6}$/, { timeout: 20_000 });
  return (await id.textContent())!;
}

/** El JSON de una Server Action llamada con llamarAccion. */
const resultado = (linea: string) => JSON.parse(linea.slice(linea.indexOf(":") + 1)) as unknown;

test("venta completa desde el modal: 2 escaneos + 1 con precio especial, cliente nuevo, transferencia", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const blue = await codigoDe(IGNITE_V80, "Blue Razz Ice");
  const antes = [
    await stock(IGNITE_V80, "Mango Ice", "Ayres Plaza"),
    await stock(IGNITE_V80, "Blue Razz Ice", "Ayres Plaza"),
  ];
  await loginDueno(page);
  await abrirModal(page);
  await elegirGalpon(page, "Ayres Plaza");

  await pistola(page, mango);
  await pistola(page, mango);
  await pistola(page, blue);
  const filas = modal(page).locator('ul[aria-label="Productos de la venta"] > li');
  await expect(filas).toHaveCount(2);
  await expect(modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("2");
  await expect(filas.first()).toContainText(`Stock en Ayres Plaza: ${antes[0]}`);

  // Precio especial para Blue Razz (lista $16.500 → $15.000).
  const filaBlue = filas.filter({ hasText: "Blue Razz Ice" });
  await filaBlue.getByRole("button", { name: "Precio especial" }).click();
  const dialogoPrecio = page.getByRole("dialog", { name: "Precio especial" });
  await dialogoPrecio.getByLabel("Precio por unidad").fill("15000");
  await dialogoPrecio.getByRole("button", { name: "Aplicar precio" }).click();
  await expect(filaBlue.locator("s")).toContainText("16.500");
  await expect(filaBlue).toContainText("15.000");
  await expect(modal(page).getByTestId("total-venta")).toContainText("47.000");

  await continuar(page).click();
  await clienteNuevo(page, "Nico", telefonoNico);
  await expect(continuar(page)).toBeEnabled();
  await continuar(page).click();

  const codigo = await confirmar(page, "Transferencia");
  expect(codigo).toMatch(/^VAP-\d{6}$/);

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { items: true, cliente: true, deposito: true },
  });
  expect(venta.estado).toBe("CONFIRMADA");
  expect(venta.medioPago).toBe("TRANSFERENCIA");
  expect(venta.deposito.nombre).toBe("Ayres Plaza");
  expect(venta.cliente.nombre).toBe("Nico");
  expect(venta.cliente.telefono).toBe(normalizado);
  expect(venta.items).toHaveLength(2);
  let costo = 0;
  for (const [codigoBarras, cantidad, lista, cobrado, especial] of [
    [mango, 2, "16000", "16000", false],
    [blue, 1, "16500", "15000", true],
  ] as const) {
    const v = await db.variante.findFirstOrThrow({
      where: { panelId: PANEL_VAPES, codigoBarras },
    });
    const item = venta.items.find((i) => i.varianteId === v.id)!;
    expect(item.cantidad).toBe(cantidad);
    expect(item.precioLista.toString()).toBe(lista);
    expect(item.precioUnitario.toString()).toBe(cobrado);
    expect(item.esPrecioEspecial).toBe(especial);
    expect(item.costoUnitario.toString()).toBe((v.ultimoCosto ?? 0).toString());
    costo += Number(item.costoUnitario) * cantidad;
  }
  expect(Number(venta.total)).toBe(47000);
  expect(Number(venta.gananciaBruta)).toBe(47000 - costo);

  const movimientos = await db.movimientoStock.findMany({
    where: { panelId: PANEL_VAPES, referenciaTipo: "VENTA", referenciaId: venta.id },
    include: { deposito: true },
  });
  expect(movimientos).toHaveLength(2);
  expect(movimientos.every((m) => m.tipo === "VENTA" && m.deposito.nombre === "Ayres Plaza")).toBe(
    true,
  );
  expect(await stock(IGNITE_V80, "Mango Ice", "Ayres Plaza")).toBe(antes[0]! - 2);
  expect(await stock(IGNITE_V80, "Blue Razz Ice", "Ayres Plaza")).toBe(antes[1]! - 1);

  // WhatsApp: wa.me/{teléfono sin +} con el ID, los ítems y el total.
  const href = await modal(page).getByTestId("whatsapp-venta").getAttribute("href");
  expect(href).toMatch(new RegExp(`^https://wa\\.me/${normalizado.slice(1)}\\?text=`));
  const texto = decodeURIComponent(href!.split("?text=")[1]!);
  expect(texto).toContain(codigo);
  expect(texto).toContain(`2 × ${IGNITE_V80} — Mango Ice`);
  expect(texto).toContain(`1 × ${IGNITE_V80} — Blue Razz Ice`);
  expect(texto).toMatch(/Total: \$\s?47\.000/);

  // El listado la muestra con su ID.
  await modal(page).getByRole("button", { name: "Cerrar", exact: true }).last().click();
  await expect(page.getByRole("link", { name: codigo }).first()).toBeVisible();
});

test("cliente nuevo con un teléfono que ya existe → detecta a Nico y lo selecciona", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const nico = await db.cliente.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, telefono: normalizado },
  });
  const cargador = await codigoDe(CARGADOR, "Único");
  await loginDueno(page);
  await abrirModal(page);
  await elegirGalpon(page, "Ayres Plaza");
  await pistola(page, cargador);
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  await continuar(page).click();

  await clienteNuevo(page, "Nicolás", telefonoNico);
  await expect(modal(page).getByText("Ese teléfono es de")).toBeVisible();
  await expect(continuar(page)).toBeDisabled();
  await modal(page).getByRole("button", { name: "Seleccionar a Nico" }).click();
  await expect(modal(page).getByTestId("cliente-seleccionado")).toContainText("Nico");
  await continuar(page).click();
  const codigo = await confirmar(page, "Efectivo");

  const venta = await db.venta.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigo } });
  expect(venta.clienteId).toBe(nico.id);
  expect(venta.medioPago).toBe("EFECTIVO");
  expect(await db.cliente.count({ where: { panelId: PANEL_VAPES, telefono: normalizado } })).toBe(
    1,
  );

  // Aunque se saltee la UI, el servidor devuelve el cliente existente para seleccionarlo.
  const v = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigoBarras: cargador },
  });
  const r = await llamarAccion(
    page,
    "generarVentaAction",
    {
      depositoId: await depositoId("Ayres Plaza"),
      cliente: { nuevo: { nombre: "Nicolás", telefono: telefonoNico } },
      items: [{ varianteId: v.id, cantidad: 1 }],
      medioPago: "EFECTIVO",
    },
    "/p/vapes/ventas",
  );
  expect(resultado(r)).toMatchObject({
    ok: true,
    data: { tipo: "cliente_duplicado", cliente: { id: nico.id, nombre: "Nico" } },
  });
});

test("más unidades que el stock del galpón: la UI no deja avanzar y el servidor rechaza todo", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const grape = await codigoDe(IGNITE_V80, "Grape Ice");
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const hay = await stock(IGNITE_V80, "Grape Ice", "Ayres Plaza");
  const hayMango = await stock(IGNITE_V80, "Mango Ice", "Ayres Plaza");
  const ventas = await db.venta.count({ where: { panelId: PANEL_VAPES } });
  const movimientos = await db.movimientoStock.count({ where: { panelId: PANEL_VAPES } });

  await loginDueno(page);
  await abrirModal(page);
  await elegirGalpon(page, "Ayres Plaza");
  await pistola(page, grape);
  const cantidad = modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Grape Ice`);
  await cantidad.fill(String(hay + 5));
  await cantidad.blur();
  await expect(modal(page).locator("li[data-sin-stock]")).toBeVisible();
  await expect(modal(page).getByText(`Solo hay ${hay} en Ayres Plaza`)).toBeVisible();
  await expect(continuar(page)).toBeDisabled();

  const nico = await db.cliente.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, telefono: normalizado },
  });
  const [vGrape, vMango] = await Promise.all(
    [grape, mango].map((c) =>
      db.variante.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigoBarras: c } }),
    ),
  );
  const r = await llamarAccion(
    page,
    "generarVentaAction",
    {
      depositoId: await depositoId("Ayres Plaza"),
      cliente: { id: nico.id },
      items: [
        { varianteId: vMango!.id, cantidad: 1 },
        { varianteId: vGrape!.id, cantidad: hay + 5 },
      ],
      medioPago: "EFECTIVO",
    },
    "/p/vapes/ventas",
  );
  expect(r).toContain("STOCK_INSUFICIENTE");
  expect(r).toContain(
    `No hay stock de ${IGNITE_V80} — Grape Ice en Ayres Plaza: hay ${hay}, se piden ${hay + 5}`,
  );
  expect(await stock(IGNITE_V80, "Grape Ice", "Ayres Plaza")).toBe(hay);
  expect(await stock(IGNITE_V80, "Mango Ice", "Ayres Plaza")).toBe(hayMango);
  expect(await db.venta.count({ where: { panelId: PANEL_VAPES } })).toBe(ventas);
  expect(await db.movimientoStock.count({ where: { panelId: PANEL_VAPES } })).toBe(movimientos);

  // Cerrar con ítems pide confirmación.
  await page.keyboard.press("Escape");
  const cierre = page.getByRole("dialog", { name: "¿Cerrar la venta en curso?" });
  await expect(cierre).toBeVisible();
  await cierre.getByRole("button", { name: "Descartar venta" }).click();
  await expect(modal(page)).toBeHidden();
});

test("Trinidad vende y da de alta al cliente: sin precio especial ni descuento", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const telefono = `11 6${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`;
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await abrirModal(page);
  await elegirGalpon(page, "Ayres Plaza");
  await pistola(page, mango);
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  await expect(modal(page).getByRole("button", { name: "Precio especial" })).toHaveCount(0);
  await continuar(page).click();
  await clienteNuevo(page, "Clienta de Trini", telefono);
  await expect(continuar(page)).toBeEnabled();
  await continuar(page).click();
  await expect(modal(page).getByRole("radio", { name: "Efectivo" })).toBeVisible();
  await expect(modal(page).getByLabel(/Descuento/)).toHaveCount(0);
  const codigo = await confirmar(page, "Efectivo");

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { cliente: true, items: true },
  });
  expect(venta.vendedorId).toBe(trinidad.id);
  expect(venta.cliente.nombre).toBe("Clienta de Trini");
  expect(venta.items[0]!.esPrecioEspecial).toBe(false);

  // Forzar un precio especial (o un descuento) salteando la UI → FORBIDDEN.
  const v = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigoBarras: mango },
  });
  const base = {
    depositoId: await depositoId("Ayres Plaza"),
    cliente: { id: venta.clienteId },
    medioPago: "EFECTIVO",
  };
  const especial = await llamarAccion(
    page,
    "generarVentaAction",
    { ...base, items: [{ varianteId: v.id, cantidad: 1, precioEspecial: 100 }] },
    "/p/vapes/ventas",
  );
  expect(especial).toContain("FORBIDDEN");
  const descuento = await llamarAccion(
    page,
    "generarVentaAction",
    { ...base, items: [{ varianteId: v.id, cantidad: 1 }], descuento: 1000 },
    "/p/vapes/ventas",
  );
  expect(descuento).toContain("FORBIDDEN");
  // Anular: solo dueños.
  const anular = await llamarAccion(
    page,
    "anularVentaAction",
    { ventaId: venta.id, motivo: "Probando" },
    "/p/vapes/ventas",
  );
  expect(anular).toContain("FORBIDDEN");
});

test("venta en Cosmetic → ID COS-######", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const codigoBarras = `99${sufijo()}${sufijo().slice(0, 3)}`;
  await loginDueno(page);
  await page.goto("/p/cosmetic/productos");
  const alta = await llamarAccion(
    page,
    "altaRapidaAction",
    {
      codigoBarras,
      marca: "Marca Cos",
      modelo: `Crema ${codigoBarras.slice(-4)}`,
      especificacion: "",
      sabor: "",
      precioVenta: "5000",
    },
    "/p/cosmetic/productos",
  );
  expect(alta).toContain('"ok":true');
  const variante = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigoBarras },
  });
  const carga = await llamarAccion(
    page,
    "cargarStockPorEscaneoAction",
    { depositoId: "dep_cosmetic_principal", items: [{ varianteId: variante.id, cantidad: 3 }] },
    "/p/cosmetic/productos/cargar",
  );
  expect(carga).toContain('"ok":true');

  await abrirModal(page, "cosmetic");
  await elegirGalpon(page, "Principal");
  await pistola(page, codigoBarras);
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  await continuar(page).click();
  // El teléfono de Nico es otro cliente en otro panel: acá es nuevo.
  await clienteNuevo(page, "Clienta Cosmetic", telefonoNico);
  await expect(continuar(page)).toBeEnabled();
  await continuar(page).click();
  const codigo = await confirmar(page, "Binance");
  expect(codigo).toMatch(/^COS-\d{6}$/);
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, codigo },
    include: { cliente: true },
  });
  expect(venta.medioPago).toBe("BINANCE");
  expect(venta.cliente.panelId).toBe(PANEL_COSMETIC);
  const s = await db.stock.findFirstOrThrow({
    where: { panelId: PANEL_COSMETIC, varianteId: variante.id },
  });
  expect(s.cantidad).toBe(2);
});

test("celular: modal a pantalla completa, venta con cámara/pistola y retomar la venta en curso", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "flujo de celular");
  const cool = await codigoDe("Elf Bar BC 5000", "Cool Mint");
  const antes = await stock("Elf Bar BC 5000", "Cool Mint", "Ayres Plaza");
  await loginDueno(page);
  await abrirModal(page);
  // A pantalla completa (se mide al terminar la animación de entrada).
  await expect
    .poll(async () => (await modal(page).boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1);
  await elegirGalpon(page, "Ayres Plaza");
  await pistola(page, cool);
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);

  // Recargar: la venta en curso se puede retomar.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Retomar venta en curso/ }).click();
  await expect(modal(page).locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(1);
  await continuar(page).click();
  await clienteNuevo(page, "Cliente celular", `11 7${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`);
  await expect(continuar(page)).toBeEnabled();
  await continuar(page).click();
  const codigo = await confirmar(page, "Efectivo");
  expect(codigo).toMatch(/^VAP-\d{6}$/);
  expect(await stock("Elf Bar BC 5000", "Cool Mint", "Ayres Plaza")).toBe(antes - 1);
});
