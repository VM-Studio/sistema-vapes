import { expect, test } from "./base";

import {
  codigoDe,
  esperarCatalogoOffline,
  loginDueno,
  pistola,
  stock,
  soltarFoco,
  ELF_BAR_BC5000,
} from "./helpers";

/**
 * Sin señal, el escáner es SOLO de lectura: reconoce códigos con el catálogo
 * del panel guardado en IndexedDB; ingresar, contar, transferir y vender
 * necesitan conexión (no hay cola de operaciones).
 */
test("sin conexión: el escáner consulta desde IndexedDB y bloquea las operaciones", async ({
  page,
  context,
}) => {
  const codigo = await codigoDe(ELF_BAR_BC5000, "Peach Mango");
  const antes = await stock(ELF_BAR_BC5000, "Peach Mango", "Ayres Plaza");
  await loginDueno(page);
  await page.goto("/p/vapes/escanear");
  await esperarCatalogoOffline(page);

  await context.setOffline(true);
  await expect(page.getByTestId("version-catalogo")).toContainText("Sin conexión");

  // Consultar: el código se resuelve con el catálogo guardado del panel.
  await soltarFoco(page);
  await pistola(page, codigo);
  const producto = page.getByRole("region", { name: "Producto" });
  await expect(producto.getByRole("heading", { level: 2 })).toHaveText(ELF_BAR_BC5000);
  await expect(producto).toContainText("Peach Mango");

  // Cargar stock / contar / transferir: bloqueados con el motivo.
  for (const modo of ["Cargar stock", "Contar", "Transferir"]) {
    const tab = page.getByRole("tab", { name: new RegExp(modo) });
    await expect(tab).toHaveAttribute("aria-disabled", "true");
    await expect(tab).toHaveAttribute("title", "Sin conexión: esta acción necesita señal.");
  }

  await context.setOffline(false);
  await expect(page.getByTestId("version-catalogo")).toContainText("Con conexión");
  expect(await stock(ELF_BAR_BC5000, "Peach Mango", "Ayres Plaza")).toBe(antes);
});

test("sin conexión: vender está bloqueado con el mensaje exacto", async ({ page, context }) => {
  await loginDueno(page);
  await page.goto("/p/vapes/ventas/nueva");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByText("Las ventas necesitan conexión para validar stock y registrar el pago").first(),
  ).toBeVisible();
  await context.setOffline(false);
});
