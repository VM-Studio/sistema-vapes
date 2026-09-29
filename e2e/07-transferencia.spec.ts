import { expect, test } from "./base";

import { depositoId, loginDueno, stock, IGNITE_V80 } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

const SABOR = "Blue Razz Ice";

test("transferencia desde la fila del stock → se completa en el acto y queda en el ledger", async ({
  page,
}) => {
  const [g1, g2] = [
    await stock(IGNITE_V80, SABOR, "Ayres Plaza"),
    await stock(IGNITE_V80, SABOR, "Mercedes"),
  ];
  await loginDueno(page);
  await page.goto(
    `/p/vapes/stock?tab=${await depositoId("Ayres Plaza")}&q=${encodeURIComponent(SABOR)}`,
  );
  await page
    .getByRole("button", { name: `Transferir ${IGNITE_V80} — ${SABOR} a Mercedes` })
    .locator("visible=true")
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Transferir a Mercedes" });
  const cantidad = sheet.getByLabel("Cantidad a transferir");
  await cantidad.fill("2");
  await cantidad.blur();
  await sheet.getByRole("button", { name: "Transferir 2 u." }).click();
  await expect(page.getByText(/Transferencia #\d+ completada/)).toBeVisible();

  await expect.poll(() => stock(IGNITE_V80, SABOR, "Ayres Plaza")).toBe(g1 - 2);
  expect(await stock(IGNITE_V80, SABOR, "Mercedes")).toBe(g2 + 2);

  // La referencia del ledger abre la transferencia, ya completada.
  await page
    .getByRole("link", { name: /Transferencia #\d+/ })
    .locator("visible=true")
    .first()
    .click();
  await expect(page).toHaveURL(/\/p\/vapes\/stock\/movimientos\/transferencias\//);
  await expect(page.getByText("Completada").first()).toBeVisible();
});
