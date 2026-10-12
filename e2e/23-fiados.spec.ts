import type { Page } from "@playwright/test";

import { formatearPesos } from "../src/lib/format";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  esperarPdf,
  IGNITE_V80,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Pagos mixtos y fiados: venta con pago dividido y "Fiar el resto" → la deuda
 * aparece en /fiados → cuenta corriente → cobro con recibo por WhatsApp. Venta
 * fiada entera con el botón «Fiado» → cobro parcial → cobro final → PAGADA.
 * Trinidad (sin FIADOS) divide pagos pero no puede fiar (ni ve «Fiado») ni
 * entrar a /fiados.
 */
test.describe.configure({ mode: "serial" });

let urlRecibo = "";
const sufijo = () => `${Date.now()}`.slice(-4) + `${Math.floor(Math.random() * 9000) + 1000}`;
const modal = (page: Page) => page.getByTestId("modal-venta");
const continuar = (page: Page) =>
  modal(page).getByRole("button", { name: "Continuar", exact: true });

/** Modal hasta el paso "¿Cómo paga?" con 2 Mango Ice de Ayres Plaza y un cliente nuevo. */
async function hastaElPago(page: Page, cliente: string, telefono: string) {
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
  await modal(page)
    .getByRole("radio", { name: /Ayres Plaza/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await soltarFoco(page);
  await pistola(page, mango);
  await pistola(page, mango);
  await expect(modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("2");
  await continuar(page).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill(cliente);
  await modal(page).getByLabel("Teléfono").fill(telefono);
  await continuar(page).click();
  await expect(modal(page).getByText("¿Cómo paga?")).toBeVisible();
}

test("venta con pago dividido y fiado → /fiados → cobro con recibo por WhatsApp", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const cliente = `Fiado ${sufijo()}`;
  const telefono = `11 7${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`;
  await loginDueno(page);
  await hastaElPago(page, cliente, telefono);

  // Dividir: $10.000 en efectivo; la segunda fila (con el restante) se vacía → queda pendiente.
  await modal(page).getByRole("button", { name: "Dividir pago" }).click();
  await modal(page).getByLabel("Monto del pago 1").fill("10000");
  await expect(modal(page).getByLabel("Monto del pago 2")).not.toHaveValue("");
  await modal(page).getByLabel("Monto del pago 2").fill("");
  await expect(modal(page).getByTestId("control-pago")).toContainText("10.000");
  const confirmar = modal(page).getByRole("button", { name: "Confirmar venta" });
  await expect(confirmar).toBeDisabled();
  await modal(page).getByRole("switch", { name: "Fiar el resto" }).click();
  await expect(modal(page).getByTestId("queda-pendiente")).toContainText(cliente);
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;
  await expect(modal(page).getByTestId("pago-parcial")).toContainText("Pagado $");

  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { pagos: true, cliente: true },
  });
  const pendiente = Number(venta.total) - 10_000;
  expect(venta.estadoPago).toBe("PARCIAL");
  expect(Number(venta.montoPagado)).toBe(10_000);
  expect(Number(venta.saldoPendiente)).toBe(pendiente);
  expect(venta.pagos).toHaveLength(1);
  expect(venta.pagos[0]!.medioPago).toBe("EFECTIVO");
  expect(Number(venta.cliente.saldoDeudor)).toBe(pendiente);
  await page.keyboard.press("Escape");

  // /fiados lo lista con su deuda.
  await page.goto(`/p/vapes/fiados?q=${encodeURIComponent(cliente)}`);
  await expect(page.getByRole("heading", { name: "Fiados", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumen de fiados" })).toContainText("Por cobrar");
  const fila = page.getByRole("row").filter({ hasText: cliente });
  await expect(fila).toBeVisible();
  await fila.getByRole("link", { name: cliente }).click();
  await expect(page).toHaveURL(new RegExp(`/p/vapes/fiados/${venta.clienteId}$`));
  await expect(page.getByTestId("ventas-pendientes")).toContainText(codigo);

  // Cobro por Binance de toda la deuda.
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  const hoja = page.getByRole("dialog", { name: `Cobro a ${cliente}` });
  await expect(hoja.getByLabel("Monto")).toHaveValue(pendiente.toFixed(2));
  await hoja.getByRole("radio", { name: "Binance" }).click();
  await hoja.getByLabel("Referencia (opcional)").fill("BNB-E2E");
  await hoja.getByRole("button", { name: "Registrar cobro" }).click();
  const hecho = page.getByRole("dialog", { name: "Cobro registrado" });
  await expect(hecho.getByTestId("saldo-restante")).toHaveText("La cuenta quedó al día");
  const recibo = hecho.getByTestId("recibo-whatsapp");
  await expect(recibo).toHaveAttribute("href", /^https:\/\/wa\.me\/54\d+\?text=/);
  expect(decodeURIComponent((await recibo.getAttribute("href"))!)).toContain(`Venta ${codigo}`);
  // Recibo PDF del cobro: ruta propia, en una pestaña nueva.
  const reciboPdf = hecho.getByTestId("recibo-pdf");
  await expect(reciboPdf).toHaveAttribute("target", "_blank");
  const hrefRecibo = (await reciboPdf.getAttribute("href"))!;
  expect(hrefRecibo).toMatch(/^\/api\/p\/vapes\/fiados\/cobros\/[^/]+\/recibo$/);
  await esperarPdf(page.request, hrefRecibo);
  urlRecibo = hrefRecibo;

  const pagada = await db.venta.findUniqueOrThrow({
    where: { id: venta.id },
    include: { pagos: { orderBy: { createdAt: "asc" } }, cliente: true },
  });
  expect(pagada.estadoPago).toBe("PAGADA");
  expect(Number(pagada.saldoPendiente)).toBe(0);
  expect(Number(pagada.cliente.saldoDeudor)).toBe(0);
  expect(pagada.pagos[1]).toMatchObject({
    medioPago: "BINANCE",
    esCobroPosterior: true,
    referencia: "BNB-E2E",
  });

  // El detalle de la venta muestra los dos pagos y el link a la cuenta corriente.
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  const pagos = page.getByTestId("pagos-venta");
  await expect(pagos).toContainText("Pagada");
  await expect(pagos).toContainText("Binance");
  await expect(pagos.getByRole("link", { name: /cuenta corriente/ })).toBeVisible();
});

test("botón «Fiado»: venta fiada entera → /fiados → cobro parcial → cobro final → PAGADA", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const cliente = `Fiado total ${sufijo()}`;
  const telefono = `11 6${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`;
  await loginDueno(page);
  await hastaElPago(page, cliente, telefono);

  const confirmar = modal(page).getByRole("button", { name: "Confirmar venta" });
  await expect(confirmar).toBeDisabled();
  const fiado = modal(page).getByRole("radio", { name: "Fiado" });
  await fiado.click();
  await expect(fiado).toHaveAttribute("aria-checked", "true");
  const total = (await modal(page).getByTestId("total-venta").textContent())!.trim();
  const banner = modal(page).getByTestId("venta-fiada");
  await expect(banner).toHaveText(`Esta venta queda fiada a ${cliente} por ${total}`);
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;
  await expect(modal(page).getByTestId("pago-parcial")).toHaveText(
    `Pendiente ${total} · ver en Fiados`,
  );
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, codigo },
    include: { pagos: true, cliente: true },
  });
  const deuda = Number(venta.total);
  expect(venta.estadoPago).toBe("PENDIENTE");
  expect(venta.medioPago).toBeNull();
  expect(venta.pagos).toHaveLength(0);
  expect(Number(venta.montoPagado)).toBe(0);
  expect(Number(venta.saldoPendiente)).toBe(deuda);
  expect(Number(venta.cliente.saldoDeudor)).toBe(deuda);

  // /fiados lo muestra al instante, con la antigüedad de hoy.
  await page.goto(`/p/vapes/fiados?q=${encodeURIComponent(cliente)}`);
  const fila = page.getByRole("row").filter({ hasText: cliente });
  await expect(fila).toContainText(total);
  await expect(fila).toContainText("Hoy");

  // La ficha del cliente muestra el saldo.
  await page.goto(`/p/vapes/clientes/${venta.clienteId}`);
  await expect(page.getByRole("main")).toContainText(total);

  // Cobro parcial de $10.000 en efectivo → PARCIAL.
  await page.goto(`/p/vapes/fiados/${venta.clienteId}`);
  await expect(page.getByTestId("ventas-pendientes")).toContainText(codigo);
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  let hoja = page.getByRole("dialog", { name: `Cobro a ${cliente}` });
  await hoja.getByLabel("Monto").fill("10000");
  await hoja.getByRole("radio", { name: "Efectivo" }).click();
  await hoja.getByRole("button", { name: "Registrar cobro" }).click();
  let hecho = page.getByRole("dialog", { name: "Cobro registrado" });
  await expect(hecho.getByTestId("saldo-restante")).toContainText("Saldo restante");
  await expect
    .poll(async () => (await db.venta.findUniqueOrThrow({ where: { id: venta.id } })).estadoPago)
    .toBe("PARCIAL");
  await hecho.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  await expect(hecho).toBeHidden();
  // La cuenta corriente se refresca con lo que queda debiendo.
  await expect(page.getByTestId("ventas-pendientes")).toContainText(formatearPesos(deuda - 10_000));

  // Cobro final por transferencia (el monto viene precargado con el saldo) → PAGADA.
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  hoja = page.getByRole("dialog", { name: `Cobro a ${cliente}` });
  await expect(hoja.getByLabel("Monto")).toHaveValue((deuda - 10_000).toFixed(2));
  await hoja.getByRole("radio", { name: "Transferencia" }).click();
  await hoja.getByRole("button", { name: "Registrar cobro" }).click();
  hecho = page.getByRole("dialog", { name: "Cobro registrado" });
  await expect(hecho.getByTestId("saldo-restante")).toHaveText("La cuenta quedó al día");

  const pagada = await db.venta.findUniqueOrThrow({
    where: { id: venta.id },
    include: { pagos: { orderBy: { createdAt: "asc" } }, cliente: true },
  });
  expect(pagada.estadoPago).toBe("PAGADA");
  expect(Number(pagada.saldoPendiente)).toBe(0);
  expect(Number(pagada.montoPagado)).toBe(deuda);
  expect(Number(pagada.cliente.saldoDeudor)).toBe(0);
  expect(pagada.pagos.map((p) => [p.medioPago, p.esCobroPosterior])).toEqual([
    ["EFECTIVO", true],
    ["TRANSFERENCIA", true],
  ]);

  // Cada cobro de la cuenta corriente tiene su recibo PDF.
  await hecho.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  // (la tabla de escritorio y las cards de celular están en el DOM: solo las visibles)
  const recibos = page.locator('[data-testid="recibo-cobro"]:visible');
  await expect(recibos).toHaveCount(2);
  for (const r of await recibos.all())
    await esperarPdf(page.request, (await r.getAttribute("href"))!);
});

test("Trinidad divide pagos pero no puede fiar ni entrar a /fiados", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await hastaElPago(page, `Trini ${sufijo()}`, `11 8${sufijo().slice(0, 3)} ${sufijo().slice(-4)}`);
  await modal(page).getByRole("button", { name: "Dividir pago" }).click();
  await modal(page).getByLabel("Monto del pago 1").fill("10000");
  await modal(page).getByLabel("Monto del pago 2").fill("");
  await expect(modal(page).getByTestId("pago-no-cubre")).toHaveText("El pago no cubre el total");
  await expect(modal(page).getByRole("switch", { name: "Fiar el resto" })).toHaveCount(0);
  await expect(modal(page).getByRole("radio", { name: "Fiado" })).toHaveCount(0);
  await expect(modal(page).getByRole("button", { name: "Confirmar venta" })).toBeDisabled();

  await page.goto("/p/vapes/fiados");
  await expect(page).toHaveURL(/sin-acceso/);
  // Sin FIADOS tampoco abre recibos.
  if (urlRecibo) expect((await page.request.get(urlRecibo)).status()).toBe(403);
});
