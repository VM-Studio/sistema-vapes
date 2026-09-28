import { expect, test } from "./base";

import { codigoDe, db, loginDueno, pistola, stock, soltarFoco } from "./helpers";

test("ingreso por escáner simulado (teclas cada 10 ms) → stock y ledger", async ({ page }) => {
  const codigo = await codigoDe("Elf Bar BC5000", "Cool Mint");
  const antes = await stock("Elf Bar BC5000", "Cool Mint", "Ayres Plaza");
  const motivo = `Ingreso e2e ${Date.now()}`;
  await loginDueno(page);
  await page.goto("/p/vapes/escanear?modo=ingresar");
  await page.getByLabel("Depósito", { exact: true }).selectOption({ label: "Ayres Plaza" });
  await soltarFoco(page);
  await pistola(page, codigo);
  await pistola(page, codigo);
  await pistola(page, codigo);
  await expect(page.getByLabel("Cantidad de Elf Bar BC5000 — Cool Mint")).toHaveValue("3");
  await page.getByRole("button", { name: /Confirmar ingreso \(3 u\.\)/ }).click();
  await page.getByLabel("Motivo").fill(motivo);
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar ingreso" }).click();
  await expect(page.getByText(/Ingresaron 3 unidades/)).toBeVisible();

  expect(await stock("Elf Bar BC5000", "Cool Mint", "Ayres Plaza")).toBe(antes + 3);
  const mov = await db.movimientoStock.findFirstOrThrow({ where: { motivo } });
  expect(mov).toMatchObject({
    tipo: "INGRESO_MANUAL",
    cantidad: 3,
    stockAnterior: antes,
    stockPosterior: antes + 3,
  });
});
