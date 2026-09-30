import { expect, test } from "./base";

import { codigoDe, db, ELF_BAR_BC5000, loginDueno, pistola, stock, soltarFoco } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

test("carga de stock por escáner simulado (teclas cada 10 ms) → stock y ledger", async ({
  page,
}) => {
  const codigo = await codigoDe(ELF_BAR_BC5000, "Cool Mint");
  const antes = await stock(ELF_BAR_BC5000, "Cool Mint", "Ayres Plaza");
  const desde = new Date();
  await loginDueno(page);
  await page.goto("/p/vapes/productos/cargar");
  await page.getByRole("radio", { name: /Ayres Plaza/ }).click();
  await page.getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await expect(page.getByTestId("galpon-actual")).toHaveText("Ayres Plaza");
  await soltarFoco(page);
  await pistola(page, codigo);
  await pistola(page, codigo);
  await pistola(page, codigo);
  await expect(page.getByLabel(`Cantidad de ${ELF_BAR_BC5000} — Cool Mint`)).toHaveValue("3");
  // Vapes tiene dos galpones: paso "Distribuir" con todo en el de ingreso.
  await page.getByRole("button", { name: "Continuar con 3 unidades" }).click();
  await expect(page.getByRole("heading", { name: "Distribuir entre galpones" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar carga" }).click();
  await expect(page.getByText("Cargaste 3 unidades en Ayres Plaza")).toBeVisible();

  expect(await stock(ELF_BAR_BC5000, "Cool Mint", "Ayres Plaza")).toBe(antes + 3);
  const mov = await db.movimientoStock.findFirstOrThrow({
    where: {
      tipo: "INGRESO_MANUAL",
      createdAt: { gte: desde },
      variante: { codigoBarras: codigo },
    },
  });
  expect(mov).toMatchObject({ cantidad: 3, stockAnterior: antes, stockPosterior: antes + 3 });
});
