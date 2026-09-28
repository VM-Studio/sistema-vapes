import { expect, test } from "./base";

import {
  codigoDe,
  db,
  depositoId,
  llamarAccion,
  loginDueno,
  pistola,
  stock,
  soltarFoco,
} from "./helpers";

test("venta con stock insuficiente → error visible, nada descontado", async ({ page }) => {
  const grape = await codigoDe("Ignite V80", "Grape Ice");
  const hay = await stock("Ignite V80", "Grape Ice", "Ayres Plaza");
  const confirmadas = await db.venta.count({
    where: { panelId: "pnl_vapes", estado: "CONFIRMADA" },
  });
  await loginDueno(page);
  await page.goto("/p/vapes/ventas/nueva");
  await page.getByLabel("Depósito de venta").selectOption({ label: "Ayres Plaza" });
  await soltarFoco(page);
  await pistola(page, grape);
  const cantidad = page.getByLabel("Cantidad de Ignite V80 — Grape Ice");
  await cantidad.fill(String(hay + 5));
  await cantidad.blur();
  // UI: la fila queda marcada y no deja cobrar.
  await expect(page.locator("li[data-sin-stock]")).toBeVisible();
  // Aviso visible y ningún botón de cobro habilitado (celular: «Cobrar» deshabilitado;
  // escritorio: el panel de cobro no aparece hasta ajustar la cantidad).
  await expect(page.getByText(/Solo hay \d+ en Ayres Plaza/).first()).toBeVisible();
  const botones = page.getByRole("button", { name: /^Cobrar( |$)/ });
  expect(
    await botones.evaluateAll((bs) =>
      bs
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .every((b) => (b as HTMLButtonElement).disabled),
    ),
  ).toBe(true);

  // Servidor: aunque alguien salteara la UI, la venta se rechaza entera.
  const v = await db.variante.findFirstOrThrow({
    where: { panelId: "pnl_vapes", codigoBarras: grape },
  });
  const r = await llamarAccion(
    page,
    "venderAction",
    {
      venta: {
        depositoId: await depositoId("Ayres Plaza"),
        items: [{ varianteId: v.id, cantidad: hay + 5 }],
      },
      medioPago: "EFECTIVO",
      redondearA: 0,
    },
    "/p/vapes/ventas/nueva",
  );
  expect(r).toContain("STOCK_INSUFICIENTE");
  expect(await stock("Ignite V80", "Grape Ice", "Ayres Plaza")).toBe(hay);
  expect(await db.venta.count({ where: { panelId: "pnl_vapes", estado: "CONFIRMADA" } })).toBe(
    confirmadas,
  );
});
