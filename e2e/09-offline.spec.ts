import { expect, test } from "./base";

import { codigoDe, esperarCatalogoOffline, loginDueno, ELF_BAR_BC5000 } from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Sin señal, la app es SOLO de consulta: /offline (la página de respaldo del
 * service worker) reconoce códigos con el catálogo del panel guardado en
 * IndexedDB. Ventas, cargas y transferencias necesitan conexión.
 */
test("sin conexión: /offline consulta producto y stock desde IndexedDB", async ({
  page,
  context,
}) => {
  const codigo = await codigoDe(ELF_BAR_BC5000, "Peach Mango");
  await loginDueno(page);
  await page.goto("/p/vapes");
  await esperarCatalogoOffline(page);
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const campo = page.getByLabel("Código");
  await campo.fill(codigo);
  await campo.press("Enter");
  const producto = page.getByRole("region", { name: "Producto" });
  await expect(producto).toContainText(ELF_BAR_BC5000);
  await expect(producto).toContainText("Peach Mango");
  await expect(producto).toContainText("Ayres Plaza");

  await campo.fill("0000000000000");
  await campo.press("Enter");
  await expect(page.getByText(/Código no encontrado en el catálogo offline/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("link", { name: /Volvió la conexión/ })).toBeVisible();
});

test("sin conexión: vender está bloqueado con el mensaje exacto", async ({ page, context }) => {
  await loginDueno(page);
  await page.goto("/p/vapes/ventas?nueva=1");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByText("Las ventas necesitan conexión para validar stock y registrar el pago").first(),
  ).toBeVisible();
  await context.setOffline(false);
});
