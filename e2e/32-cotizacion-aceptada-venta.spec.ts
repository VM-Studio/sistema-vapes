import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, llamarAccion, login, PANEL_VAPES } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * A4: Trinidad vende desde sus cotizaciones. En la lista del cotizador marca
 * una cotización «Aceptada ✓» → modal corto (galpón principal por defecto) →
 * se registra la venta a su nombre, con los precios de la cotización, el
 * stock descontado y PENDIENTE de pago (sin FIADOS). Desde el detalle,
 * «Marcar pagada»: primero una parte, después el resto por Transferencia →
 * «Pagada con Transferencia el …». El filtro «Estado de pago» de Ventas la
 * muestra en pendientes / pagadas según corresponda.
 */
test.describe.configure({ mode: "serial" });

const n = `${Date.now()}`.slice(-6);

test("Trinidad acepta su cotización desde la lista y después la marca pagada", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio (crea datos únicos)");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  const principal = await db.deposito.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, esPrincipal: true },
  });
  const conStock = await db.stock.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, depositoId: principal.id, cantidad: { gte: 5 } },
    orderBy: { cantidad: "desc" },
  });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes/cotizador");

  const r = await llamarAccion(
    page,
    "guardarCotizacionAction",
    {
      tipo: "UNITARIA",
      items: [{ varianteId: conStock.varianteId, cantidad: 2 }],
      cliente: {
        nombre: `Cliente cotización ${n}`,
        telefono: `11 6${n.slice(0, 3)} ${n.slice(-4)}`,
      },
    },
    // La acción se invoca desde la página que la usa (el editor de cotizaciones).
    "/p/vapes/cotizador/unitaria/nueva",
  );
  expect(r).toContain('"ok":true');
  const codigoQ = /"codigo":"(VAP-Q-\d{6})"/.exec(r)![1]!;

  // Lista del cotizador → «Aceptada» → modal → Registrar venta.
  await page.goto("/p/vapes/cotizador");
  await page
    .getByRole("button", { name: `Marcar ${codigoQ} como aceptada` })
    .filter({ visible: true })
    .click();
  const dialogo = page.getByRole("dialog", { name: `¿${codigoQ} aceptada?` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByLabel("Galpón")).toHaveValue(principal.id);
  await dialogo.getByRole("button", { name: "Registrar venta" }).click();
  await page.waitForURL(/\/p\/vapes\/ventas\/[^/?]+$/);
  await expect(page.getByTestId("estado-pago-venta")).toHaveText("Pendiente de pago");

  const cot = await db.cotizacion.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo: codigoQ },
    include: { venta: true },
  });
  expect(cot.estado).toBe("CONVERTIDA");
  const venta = cot.venta!;
  expect(venta).toMatchObject({
    vendedorId: trinidad.id,
    estadoPago: "PENDIENTE",
    medioPago: null,
    depositoId: principal.id,
  });
  expect(venta.saldoPendiente.toFixed(2)).toBe(venta.total.toFixed(2));
  const despues = await db.stock.findFirstOrThrow({ where: { id: conStock.id } });
  expect(despues.cantidad).toBe(conStock.cantidad - 2);

  // En la lista de ventas: pendiente de pago.
  await page.goto("/p/vapes/ventas?pago=pendiente");
  await expect(page.getByRole("link", { name: venta.codigo }).first()).toBeVisible();

  // «Marcar pagada»: una parte por Transferencia…
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await page.getByTestId(`marcar-pagada-${venta.codigo}`).click();
  let pago = page.getByRole("dialog", { name: `Pago de ${venta.codigo}` });
  await expect(pago.getByLabel("Monto")).toHaveValue(venta.saldoPendiente.toFixed(2));
  await pago.getByRole("radio", { name: "Transferencia" }).click();
  await pago.getByLabel("Monto").fill("1000");
  await pago.getByRole("button", { name: "Registrar pago" }).click();
  await expect(pago).toBeHidden();
  await expect(page.getByTestId("estado-pago-venta")).toContainText("Pago parcial");

  // …y el resto (el monto viene con el saldo).
  await page.getByTestId(`marcar-pagada-${venta.codigo}`).click();
  pago = page.getByRole("dialog", { name: `Pago de ${venta.codigo}` });
  await expect(pago.getByLabel("Monto")).toHaveValue(venta.saldoPendiente.minus(1000).toFixed(2));
  await pago.getByRole("radio", { name: "Transferencia" }).click();
  await pago.getByLabel("Referencia (opcional)").fill(`op ${n}`);
  await pago.getByRole("button", { name: "Registrar pago" }).click();
  await expect(pago).toBeHidden();
  await expect(page.getByTestId("estado-pago-venta")).toContainText(
    /^Pagada con Transferencia el \d{2}\/\d{2}\/\d{2}/,
  );
  await expect(page.getByTestId(`marcar-pagada-${venta.codigo}`)).toHaveCount(0);
  const pagada = await db.venta.findUniqueOrThrow({
    where: { id: venta.id },
    include: { pagos: true },
  });
  expect(pagada.estadoPago).toBe("PAGADA");
  expect(pagada.pagos).toHaveLength(2);
  expect(pagada.pagos.every((p) => p.esCobroPosterior && p.usuarioId === trinidad.id)).toBe(true);

  await page.goto("/p/vapes/ventas?pago=pendiente");
  await expect(page.getByRole("link", { name: venta.codigo })).toHaveCount(0);
  await page.goto("/p/vapes/ventas?pago=pagada");
  await expect(page.getByRole("link", { name: venta.codigo }).first()).toBeVisible();
});
