import { expect, test } from "./base";

import { codigoDe, loginDueno, pistola, stock, soltarFoco } from "./helpers";

test("transferencia entre galpones → totales por galpón correctos", async ({ page }) => {
  const codigo = await codigoDe("Ignite V80", "Strawberry Watermelon");
  const [g1, g2] = [
    await stock("Ignite V80", "Strawberry Watermelon", "Ayres Plaza"),
    await stock("Ignite V80", "Strawberry Watermelon", "Mercedes"),
  ];
  await loginDueno(page);
  await page.goto("/p/vapes/escanear?modo=transferir");
  await page.getByLabel("Origen").selectOption({ label: "Ayres Plaza" });
  await page.getByLabel("Destino").selectOption({ label: "Mercedes" });
  await soltarFoco(page);
  await pistola(page, codigo);
  await pistola(page, codigo);
  await page.getByRole("button", { name: /Crear transferencia \(2 u\.\)/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Crear", exact: true }).click();
  await page.getByRole("button", { name: "Completar ahora" }).click();
  await expect(page.getByText(/completada/)).toBeVisible();

  expect(await stock("Ignite V80", "Strawberry Watermelon", "Ayres Plaza")).toBe(g1 - 2);
  expect(await stock("Ignite V80", "Strawberry Watermelon", "Mercedes")).toBe(g2 + 2);
  // El total no cambia: solo se mudó de galpón.
  await page.goto("/p/vapes/stock?q=Strawberry");
  await expect(
    page
      .getByText(String(g1 + g2), { exact: true })
      .locator("visible=true")
      .first(),
  ).toBeVisible();
});
