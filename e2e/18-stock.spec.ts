import { expect, test } from "./base";

import { depositoId, IGNITE_V80, loginDueno, stock } from "./helpers";

const SABOR = "Strawberry Watermelon";

/**
 * Stock por galpón y global: la pestaña de un galpón muestra solo ese galpón
 * (y sus movimientos); Global, una columna por galpón + Total y los
 * movimientos de todos. Transferir desde la fila mueve stock entre galpones
 * sin cambiar el total del panel.
 */
test("stock: pestañas por galpón y Global; transferir 5 desde la fila no cambia el total", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "tabla de escritorio y datos únicos");
  const [ayres, mercedes] = [await depositoId("Ayres Plaza"), await depositoId("Mercedes")];
  const [g1, g2] = [
    await stock(IGNITE_V80, SABOR, "Ayres Plaza"),
    await stock(IGNITE_V80, SABOR, "Mercedes"),
  ];
  expect(g1).toBeGreaterThanOrEqual(5);
  await loginDueno(page);

  // Pestaña Ayres Plaza (la principal abre por defecto): solo ese galpón.
  await page.goto("/p/vapes/stock");
  const tabs = page.getByRole("navigation", { name: "Galpones" });
  await expect(tabs.getByRole("link", { name: "Ayres Plaza" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Mercedes" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Global" })).toBeVisible();
  const tabla = page.getByTestId("tabla-stock");
  await expect(tabla.getByRole("columnheader", { name: "Cantidad" })).toBeVisible();
  await expect(tabla.getByRole("columnheader", { name: "Mercedes" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Movimientos de Ayres Plaza" })).toBeVisible();
  const movimientos = page.getByRole("table", { name: "Movimientos de stock" });
  await expect(movimientos.getByRole("columnheader", { name: "Galpón" })).toHaveCount(0);

  // Transferir 5 a Mercedes desde la fila del sabor.
  await page.goto(`/p/vapes/stock?tab=${ayres}&q=${encodeURIComponent(SABOR)}`);
  await page
    .getByRole("button", { name: `Transferir ${IGNITE_V80} — ${SABOR} a Mercedes` })
    .click();
  const sheet = page.getByRole("dialog", { name: "Transferir a Mercedes" });
  const cantidad = sheet.getByLabel("Cantidad a transferir");
  await cantidad.fill("5");
  await cantidad.blur();
  await sheet.getByRole("button", { name: "Transferir 5 u." }).click();
  await expect(page.getByText(/Transferencia #\d+ completada/)).toBeVisible();
  await expect.poll(() => stock(IGNITE_V80, SABOR, "Ayres Plaza")).toBe(g1 - 5);
  expect(await stock(IGNITE_V80, SABOR, "Mercedes")).toBe(g2 + 5);

  // En Ayres Plaza, el movimiento de salida con su referencia.
  await expect(movimientos.getByRole("link", { name: /Transferencia #\d+/ }).first()).toBeVisible();
  await expect(movimientos.getByText(/^[-−]5$/).first()).toBeVisible();

  // Global: Ayres Plaza | Mercedes | Total; el total no cambió.
  await page.goto(`/p/vapes/stock?tab=global&q=${encodeURIComponent(SABOR)}`);
  for (const col of ["Ayres Plaza", "Mercedes", "Total"])
    await expect(tabla.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
  const fila = tabla.getByRole("row", { name: new RegExp(SABOR) });
  const celdas = fila.getByRole("cell");
  await expect(celdas.nth(2)).toHaveText(String(g1 - 5));
  await expect(celdas.nth(3)).toHaveText(String(g2 + 5));
  await expect(celdas.nth(4)).toHaveText(String(g1 + g2));

  // Movimientos de todos los galpones, con la columna galpón: salida y entrada.
  await expect(
    page.getByRole("heading", { name: "Movimientos de todos los galpones" }),
  ).toBeVisible();
  await expect(movimientos.getByRole("columnheader", { name: "Galpón" })).toBeVisible();
  await expect(
    movimientos.getByRole("cell", { name: "Mercedes", exact: true }).first(),
  ).toBeVisible();
  await expect(
    movimientos.getByRole("cell", { name: "Ayres Plaza", exact: true }).first(),
  ).toBeVisible();

  // La pestaña Mercedes ve la entrada (+5) y no la columna galpón.
  await page.goto(`/p/vapes/stock?tab=${mercedes}`);
  await expect(page.getByRole("heading", { name: "Movimientos de Mercedes" })).toBeVisible();
  await expect(movimientos.getByText("+5").first()).toBeVisible();
});
