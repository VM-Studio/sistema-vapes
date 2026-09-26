import { expect, test } from "./base";

import { crearUsuario, db, login } from "./helpers";

test("login → cambio de contraseña obligatorio → dashboard", async ({ page }) => {
  const u = await crearUsuario({
    rol: "OWNER",
    debeCambiarPassword: true,
    password: "Temporal2026x",
  });
  await login(page, u.email, u.password);
  // Con la contraseña temporal solo se puede ir a /cuenta.
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText("Tenés que cambiar tu contraseña para continuar.")).toBeVisible();
  await page.goto("/ventas");
  await expect(page).toHaveURL(/\/cuenta$/);

  // Una contraseña de la lista de las más comunes se rechaza.
  await page.getByRole("textbox", { name: "Contraseña actual" }).fill(u.password);
  await page.getByRole("textbox", { name: "Contraseña nueva", exact: true }).fill("password1");
  await page.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill("password1");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText("Contraseña demasiado común")).toBeVisible();

  await page
    .getByRole("textbox", { name: "Contraseña nueva", exact: true })
    .fill("NuevaSegura2026");
  await page.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill("NuevaSegura2026");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Buen|Buenas/);
  await expect(page.locator('section[aria-label="Indicadores"]')).toBeVisible();
  expect((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).debeCambiarPassword).toBe(
    false,
  );
});
