import { expect, test } from "./base";

import { db, loginDueno } from "./helpers";

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}

test("crear producto con 3 sabores y códigos → aparece en inventario con stock 0", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const nombre = `Vape PW ${sufijo}`;
  const sabores = ["Uva", "Menta", "Frutilla"];
  const codigos = sabores.map((_, i) => ean13(`779${sufijo}${String(i).padStart(3, "0")}`));
  await loginDueno(page);
  await page.goto("/productos/nuevo");
  await page.locator('input[name="nombre"]').fill(nombre);
  await page.locator('select[name="categoriaId"]').selectOption({ label: "Vapes" });
  await page.locator("#variantes-0-nombre").fill(sabores[0]!);
  await page.locator("#variantes-0-codigoBarras").fill(codigos[0]!);
  await page.locator("#variantes-0-precioCosto").fill("7000");
  await page.locator("#variantes-0-precioVenta").fill("13000");
  for (let i = 1; i < 3; i++) {
    await page.getByRole("button", { name: "Duplicar variante 1" }).click();
    await page.locator(`#variantes-${i}-nombre`).fill(sabores[i]!);
    await page.locator(`#variantes-${i}-codigoBarras`).fill(codigos[i]!);
  }
  await page.waitForTimeout(800); // validación en vivo de códigos (debounce)
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.waitForURL(
    (u) => /^\/productos\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/nuevo"),
  );

  const p = await db.producto.findFirstOrThrow({
    where: { nombre },
    include: { variantes: { include: { stocks: true } } },
  });
  expect(p.variantes.map((v) => v.nombre).sort()).toEqual([...sabores].sort());
  expect(p.variantes.map((v) => v.codigoBarras).sort()).toEqual([...codigos].sort());
  expect(p.variantes.flatMap((v) => v.stocks).reduce((a, s) => a + s.cantidad, 0)).toBe(0);

  await page.goto(`/inventario?q=${encodeURIComponent(nombre)}`);
  for (const s of sabores)
    await expect(page.getByText(s, { exact: false }).locator("visible=true").first()).toBeVisible();
  await expect(page.getByText("Sin stock").locator("visible=true").first()).toBeVisible();
});
