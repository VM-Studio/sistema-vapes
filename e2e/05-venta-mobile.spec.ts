import { expect, test } from "./base";

import { codigoDe, db, loginDueno, pistola, stock, soltarFoco } from "./helpers";

test("venta completa: 2 sabores escaneados, cobro partido, ticket → stock descontado", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "flujo de celular");
  const mango = await codigoDe("Ignite V80", "Mango Ice");
  const blue = await codigoDe("Ignite V80", "Blue Razz Ice");
  const antes = [
    await stock("Ignite V80", "Mango Ice", "Galpón 1"),
    await stock("Ignite V80", "Blue Razz Ice", "Galpón 1"),
  ];
  await loginDueno(page);
  await page.goto("/ventas/nueva");
  await page.getByLabel("Depósito de venta").selectOption({ label: "Galpón 1" });
  await soltarFoco(page);
  await pistola(page, mango);
  await pistola(page, blue);
  await expect(page.locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(2);

  await page.getByRole("button", { name: "Cobrar", exact: true }).click();
  const dialogo = page.locator("dialog[open]");
  await dialogo.getByLabel("Efectivo recibido").fill("10000");
  await dialogo.getByRole("button", { name: "Agregar medio de pago" }).click();
  await expect(dialogo.getByLabel("Monto Transferencia")).toHaveValue("22000");
  await dialogo.getByLabel("Referencia Transferencia").fill("OP-PW-1");
  await dialogo.getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText(/confirmada/i).first()).toBeVisible({ timeout: 20_000 });

  const venta = await db.venta.findFirstOrThrow({
    where: { estado: "CONFIRMADA", pagos: { some: { referencia: "OP-PW-1" } } },
    include: { pagos: true, comprobante: true },
  });
  expect(venta.pagos.map((p) => `${p.medioPago}:${p.monto.toFixed(0)}`).sort()).toEqual([
    "EFECTIVO:10000",
    "TRANSFERENCIA:22000",
  ]);
  expect(venta.comprobante?.tipo).toBe("TICKET");
  expect(venta.comprobante?.pdfUrl).toMatch(/^\/api\/publico\/archivos\/comprobantes\//);
  expect(await stock("Ignite V80", "Mango Ice", "Galpón 1")).toBe(antes[0]! - 1);
  expect(await stock("Ignite V80", "Blue Razz Ice", "Galpón 1")).toBe(antes[1]! - 1);
  // El ticket (PDF) se abre desde la pantalla de éxito.
  const href = await page.locator("a[href^='/api/comprobantes/']").first().getAttribute("href");
  const r = await page.request.get(href!);
  expect(r.headers()["content-type"]).toBe("application/pdf");
});
