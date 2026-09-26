import { expect, test } from "./base";

import { db, depositoId, loginDueno } from "./helpers";

test("cierre de caja con diferencia → exige observaciones y queda para revisar", async ({
  page,
}) => {
  const g2 = await depositoId("Galpón 2");
  await loginDueno(page);
  await page.goto(`/caja?deposito=${g2}&accion=abrir`);
  const sheet = page.locator("dialog[open]");
  await sheet.getByLabel("Monto inicial").fill("10000");
  await sheet.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.getByText(/Caja de Galpón 2 abierta/)).toBeVisible();

  await page
    .locator('section[aria-label="Caja de Galpón 2"]')
    .getByRole("button", { name: "Cerrar caja" })
    .click();
  // Cuenta 4 billetes de $2.000 = $8.000 (faltan $2.000, más que la tolerancia de $500).
  await sheet.getByLabel("Billetes de 2000", { exact: true }).fill("4");
  await expect(sheet.getByTestId("contado")).toContainText("8.000");
  await expect(sheet.getByTestId("diferencia")).toContainText("2.000");
  await expect(sheet.getByText("Observaciones (obligatorias)")).toBeVisible();
  await sheet.getByRole("button", { name: "Confirmar cierre" }).click();
  await expect(page.getByText(/supera la tolerancia/).first()).toBeVisible();
  expect(await db.caja.count({ where: { depositoId: g2, estado: "ABIERTA" } })).toBe(1);

  await sheet.getByLabel(/Observaciones/).fill("Faltan $2.000 (prueba e2e)");
  await sheet.getByRole("button", { name: "Confirmar cierre" }).click();
  await expect(page.getByText(/Supera la tolerancia: quedó marcada para revisión/)).toBeVisible();
  const caja = await db.caja.findFirstOrThrow({
    where: { depositoId: g2 },
    orderBy: { abiertaAt: "desc" },
  });
  expect(caja).toMatchObject({
    estado: "CERRADA",
    requiereRevision: true,
    observaciones: "Faltan $2.000 (prueba e2e)",
  });
  expect(caja.diferencia?.toFixed(2)).toBe("-2000.00");
});
