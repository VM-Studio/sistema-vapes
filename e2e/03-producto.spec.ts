import { expect, test } from "./base";

import { db, esMobile, loginDueno } from "./helpers";

function ean13(base12: string) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (s % 10)) % 10);
}

test("crear producto (marca nueva + 3 sabores, uno con precio propio) → listado con stock 0 y cargar stock", async ({
  page,
}) => {
  const sufijo = String(Date.now()).slice(-6);
  const marca = `Marca PW ${sufijo}`;
  const sabores = ["Uva", "Menta", "Frutilla"];
  const codigos = sabores.map((_, i) => ean13(`779${sufijo}${String(i).padStart(3, "0")}`));
  await loginDueno(page);
  await page.goto("/p/vapes/productos/nuevo");
  await page.locator('input[name="marca"]').fill(marca);
  await page.locator('input[name="modelo"]').fill("Pod");
  await page.getByLabel("Pitadas").fill("6000");
  await page.locator('input[name="precioVenta"]').fill("13000");
  await page.locator("#sabores-0-sabor").fill(sabores[0]!);
  await page.locator("#sabores-0-codigoBarras").fill(codigos[0]!);
  for (let i = 1; i < 3; i++) {
    await page.getByRole("button", { name: "Duplicar fila 1" }).click();
    await page.locator(`#sabores-${i}-sabor`).fill(sabores[i]!);
    await page.locator(`#sabores-${i}-codigoBarras`).fill(codigos[i]!);
  }
  await page.locator("#sabores-2-precioVenta").fill("14000");
  await page.waitForTimeout(800); // validación en vivo de códigos (debounce)
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${marca} Pod 6000 creado` })).toBeVisible();

  const p = await db.producto.findFirstOrThrow({
    where: { nombreCompleto: `${marca} Pod 6000` },
    include: { variantes: { include: { stocks: true } }, marca: true },
  });
  expect(p.marca.nombre).toBe(marca);
  expect(p.precioVenta.toFixed(2)).toBe("13000.00");
  expect(p.variantes.map((v) => v.nombre).sort()).toEqual([...sabores].sort());
  expect(p.variantes.map((v) => v.codigoBarras).sort()).toEqual([...codigos].sort());
  const propios = Object.fromEntries(
    p.variantes.map((v) => [v.nombre, v.precioVenta?.toFixed(2) ?? null]),
  );
  expect(propios).toEqual({ Uva: null, Menta: null, Frutilla: "14000.00" });
  expect(p.variantes.flatMap((v) => v.stocks).reduce((a, s) => a + s.cantidad, 0)).toBe(0);

  // "Cargar stock de este producto" → flujo de carga, primero el galpón.
  await page.getByRole("link", { name: "Cargar stock de este producto" }).click();
  await expect(page.getByRole("heading", { name: "¿En qué galpón vas a cargar?" })).toBeVisible();

  await page.goto(`/p/vapes/productos?q=${encodeURIComponent(`${marca} Pod`)}`);
  if (esMobile(page)) {
    await page.getByRole("button", { name: /Pod 6000/ }).click();
    for (const s of sabores)
      await expect(
        page.getByText(s, { exact: true }).locator("visible=true").first(),
      ).toBeVisible();
  } else {
    await page.getByRole("button", { name: `Ver sabores de ${marca} Pod 6000` }).click();
    for (const s of sabores) {
      const fila = page.getByRole("row", { name: s, exact: true });
      await expect(fila.locator('[data-deposito="Total"]')).toHaveText("0");
    }
    await expect(page.getByRole("row", { name: "Frutilla" })).toContainText("propio");
  }
});
