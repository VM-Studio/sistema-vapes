import { expect, test } from "./base";

import { codigoDe, db, loginDueno, pistola, stock, soltarFoco } from "./helpers";

test("venta completa en el celular: 2 sabores escaneados, un medio de pago, ID de venta → stock descontado", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "flujo de celular");
  const mango = await codigoDe("Ignite V80", "Mango Ice");
  const blue = await codigoDe("Ignite V80", "Blue Razz Ice");
  const antes = [
    await stock("Ignite V80", "Mango Ice", "Ayres Plaza"),
    await stock("Ignite V80", "Blue Razz Ice", "Ayres Plaza"),
  ];
  await loginDueno(page);
  await page.goto("/p/vapes/ventas/nueva");
  await page.getByLabel("Depósito de venta").selectOption({ label: "Ayres Plaza" });
  await soltarFoco(page);
  await pistola(page, mango);
  await pistola(page, blue);
  await expect(page.locator('ul[aria-label="Productos de la venta"] > li')).toHaveCount(2);

  await page.getByRole("button", { name: "Cobrar", exact: true }).click();
  const cobro = page.locator("dialog[open]");
  await cobro.getByRole("radio", { name: "Transferencia" }).click();
  await cobro.getByRole("button", { name: /^Cobrar .* con transferencia$/ }).click();

  // La venta se identifica por su ID de venta del panel (VAP-000001…).
  const id = page.getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const numero = Number((await id.textContent())!.slice(4));
  const venta = await db.venta.findFirstOrThrow({
    where: { panelId: "pnl_vapes", numero },
    include: { items: true },
  });
  expect(venta.estado).toBe("CONFIRMADA");
  expect(venta.medioPago).toBe("TRANSFERENCIA");
  expect(venta.items).toHaveLength(2);
  expect(await stock("Ignite V80", "Mango Ice", "Ayres Plaza")).toBe(antes[0]! - 1);
  expect(await stock("Ignite V80", "Blue Razz Ice", "Ayres Plaza")).toBe(antes[1]! - 1);
});
