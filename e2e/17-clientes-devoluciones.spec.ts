import { expect, test } from "./base";

import { db, EMAIL_DUENO, llamarAccion, loginDueno, PANEL_COSMETIC, PANEL_VAPES } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

const sufijo = () => String(Date.now()).slice(-7);

/** Un sabor del catálogo de ejemplo con stock en Mercedes (para entregar la unidad nueva). */
async function saborConStockEnMercedes() {
  const s = await db.stock.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, deposito: { nombre: "Mercedes" }, cantidad: { gte: 3 } },
    include: { variante: { include: { producto: true } } },
    orderBy: { cantidad: "desc" },
  });
  return { stockId: s.id, depositoId: s.depositoId, variante: s.variante };
}

/** Cliente de Vapes con una venta confirmada de 1 unidad de ese sabor (armada directo en la DB). */
async function clienteConVenta(
  s: string,
  v: Awaited<ReturnType<typeof saborConStockEnMercedes>>["variante"],
  depositoId: string,
) {
  const dueno = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL_DUENO } });
  const cliente = await db.cliente.create({
    data: { panelId: PANEL_VAPES, nombre: `Garantía ${s}`, telefono: `+5411${s}9` },
  });
  const numero = 900_000 + Math.floor(Math.random() * 90_000);
  const precio = v.precioVenta ?? v.producto.precioVenta;
  const venta = await db.venta.create({
    data: {
      panelId: PANEL_VAPES,
      numero,
      codigo: `VAP-${numero}`,
      clienteId: cliente.id,
      depositoId,
      vendedorId: dueno.id,
      medioPago: "EFECTIVO",
      montoPagado: precio,
      pagos: {
        create: { panelId: PANEL_VAPES, medioPago: "EFECTIVO", monto: precio, usuarioId: dueno.id },
      },
      subtotal: precio,
      total: precio,
      costoTotal: 0,
      gananciaBruta: precio,
      items: {
        create: {
          panelId: PANEL_VAPES,
          varianteId: v.id,
          productoId: v.productoId,
          cantidad: 1,
          precioLista: precio,
          precioUnitario: precio,
          costoUnitario: 0,
          subtotal: precio,
        },
      },
    },
  });
  return { cliente, venta };
}

test("cliente nuevo con teléfono repetido: avisa y el alta falla con el cliente existente", async ({
  page,
}) => {
  const s = sufijo();
  const existente = await db.cliente.create({
    data: { panelId: PANEL_VAPES, nombre: `Existente ${s}`, telefono: `+5411${s}1` },
  });

  await loginDueno(page);
  await page.goto("/p/vapes/clientes");
  await expect(page.getByTestId("clientes-nuevos-mes")).toContainText("Clientes nuevos este mes:");
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo cliente" });
  await sheet.getByLabel("Nombre").fill(`Repetido ${s}`);
  // Mismo número, escrito distinto: se normaliza a +54… y se detecta en vivo.
  await sheet.getByLabel("Teléfono").fill(`011 ${s.slice(0, 3)}-${s.slice(3)}1`);
  await expect(sheet.getByText(`Ese teléfono es de ${existente.nombre}`)).toBeVisible();
  await sheet.getByRole("button", { name: "Crear" }).click();
  await expect(
    sheet.getByText(`Ya existe un cliente con ese teléfono: ${existente.nombre}`),
  ).toBeVisible();
  expect(await db.cliente.count({ where: { telefono: existente.telefono } })).toBe(1);
});

test("garantía: 1 sabor desde Mercedes vinculada a la venta, y anularla repone el stock", async ({
  page,
}) => {
  const s = sufijo();
  const { variante, depositoId, stockId } = await saborConStockEnMercedes();
  const { cliente, venta } = await clienteConVenta(s, variante, depositoId);
  const stockAntes = (await db.stock.findUniqueOrThrow({ where: { id: stockId } })).cantidad;

  await loginDueno(page);
  await page.goto("/p/vapes/devoluciones");
  await page.getByRole("button", { name: "Registrar devolución" }).click();
  const modal = page.getByRole("dialog", { name: "Registrar devolución" });

  // Paso 1: cliente (buscador) + vincular la venta (precarga su sabor).
  await modal.getByLabel("Buscá el cliente por nombre o teléfono").fill(cliente.nombre);
  await modal.getByRole("button", { name: new RegExp(cliente.nombre) }).click();
  await expect(modal.getByTestId("cliente-seleccionado")).toContainText(cliente.nombre);
  await modal.getByRole("radio", { name: new RegExp(venta.codigo) }).click();
  await expect(modal.getByRole("radio", { name: new RegExp(venta.codigo) })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await modal.getByRole("button", { name: "Continuar", exact: true }).click();

  // Paso 2: galpón.
  await modal.getByRole("radio", { name: /Mercedes/ }).click();
  await modal.getByRole("button", { name: "Continuar con Mercedes" }).click();

  // Paso 3: el sabor de la venta ya está cargado, con el aviso de stock.
  await expect(modal.getByTestId("galpon-devolucion")).toHaveText("Mercedes");
  await expect(
    modal.getByText("Se descuenta del stock la unidad nueva que se entrega al cliente."),
  ).toBeVisible();
  await expect(
    modal.getByRole("list", { name: "Productos a entregar" }).getByRole("listitem"),
  ).toHaveCount(1);
  await modal.getByRole("button", { name: "Continuar", exact: true }).click();

  // Paso 4: observación obligatoria y confirmar.
  const confirmar = modal.getByRole("button", { name: "Confirmar devolución" });
  await modal.getByLabel("Observación").fill("No carga");
  await expect(confirmar).toBeDisabled();
  await modal.getByLabel("Observación").fill("No carga, luz roja parpadea");
  await confirmar.click();

  await page.waitForURL(/\/p\/vapes\/devoluciones\/[^/?]+$/);
  const titulo = page.getByRole("heading", { level: 1 });
  await expect(titulo).toContainText(/VAP-D-\d{6}/);

  const dev = await db.devolucion.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, clienteId: cliente.id },
    include: { items: true },
  });
  expect(dev.codigo).toMatch(/^VAP-D-\d{6}$/);
  expect(dev.ventaId).toBe(venta.id);
  expect(dev.depositoId).toBe(depositoId);
  expect(dev.observacion).toBe("No carga, luz roja parpadea");
  expect(dev.items).toHaveLength(1);
  expect(dev.items[0]).toMatchObject({
    varianteId: variante.id,
    productoId: variante.productoId,
    cantidad: 1,
  });

  const garantia = await db.movimientoStock.findMany({
    where: { panelId: PANEL_VAPES, referenciaTipo: "DEVOLUCION", referenciaId: dev.id },
  });
  expect(garantia).toHaveLength(1);
  expect(garantia[0]).toMatchObject({
    tipo: "GARANTIA",
    cantidad: 1,
    depositoId,
    varianteId: variante.id,
    stockAnterior: stockAntes,
    stockPosterior: stockAntes - 1,
  });
  expect((await db.stock.findUniqueOrThrow({ where: { id: stockId } })).cantidad).toBe(
    stockAntes - 1,
  );

  // Anular (dueño, con motivo): GARANTIA_ANULADA y el stock vuelve.
  await page.getByRole("button", { name: "Anular" }).click();
  const anular = page.getByRole("dialog", { name: /Anular la devolución/ });
  await anular.getByLabel("Motivo").fill("Se cargó por error");
  await anular.getByRole("button", { name: "Anular devolución" }).click();
  await expect(page.getByText(/Motivo: Se cargó por error/)).toBeVisible();

  const movs = await db.movimientoStock.findMany({
    where: { panelId: PANEL_VAPES, referenciaTipo: "DEVOLUCION", referenciaId: dev.id },
    orderBy: { createdAt: "asc" },
  });
  expect(movs.map((m) => m.tipo)).toEqual(["GARANTIA", "GARANTIA_ANULADA"]);
  expect(movs[1]).toMatchObject({ cantidad: 1, depositoId, stockPosterior: stockAntes });
  expect((await db.stock.findUniqueOrThrow({ where: { id: stockId } })).cantidad).toBe(stockAntes);
  expect((await db.devolucion.findUniqueOrThrow({ where: { id: dev.id } })).estado).toBe("ANULADA");
});

test("un cliente de Cosmetic no aparece en el buscador de Vapes", async ({ page }) => {
  const s = sufijo();
  const nombre = `Cosmetica ${s}`;
  await db.cliente.create({
    data: { panelId: PANEL_COSMETIC, nombre, telefono: `+5411${s}7` },
  });

  await loginDueno(page);
  const enVapes = await llamarAccion(
    page,
    "buscarClientesAction",
    { q: nombre },
    "/p/vapes/devoluciones",
  );
  expect(enVapes).toContain('"ok":true');
  expect(enVapes).not.toContain(nombre);
  const enCosmetic = await llamarAccion(
    page,
    "buscarClientesAction",
    { q: nombre },
    "/p/cosmetic/devoluciones",
  );
  expect(enCosmetic).toContain(nombre);

  await page.goto(`/p/vapes/clientes?q=${encodeURIComponent(nombre)}`);
  await expect(page.getByText(`No hay clientes con “${nombre}”`)).toBeVisible();
});
