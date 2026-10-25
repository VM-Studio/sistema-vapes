import { expect, test } from "./base";

import { codigoDelMail, crearUsuario, db, login } from "./helpers";

test("login → cambio de contraseña obligatorio → selector de sistemas", async ({ page }) => {
  const u = await crearUsuario({
    rol: "OWNER",
    debeCambiarPassword: true,
    password: "Temporal2026x",
  });
  await login(page, u.email, u.password);
  // Con la contraseña temporal solo se puede ir a /cuenta.
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText("Tenés que cambiar tu contraseña para continuar.")).toBeVisible();
  await page.goto("/p/vapes/ventas");
  await expect(page).toHaveURL(/\/cuenta$/);

  // Primer ingreso: el mismo flujo con código por mail (así se valida también el email).
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Código de 6 dígitos").fill(await codigoDelMail(u.email));
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByText("Código verificado")).toBeVisible();

  // Una contraseña de la lista de las más comunes se rechaza.
  await page.getByRole("textbox", { name: "Contraseña nueva", exact: true }).fill("password1");
  await page.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill("password1");
  await page.getByRole("button", { name: "Guardar contraseña nueva" }).click();
  await expect(page.getByText("Contraseña demasiado común")).toBeVisible();

  await page
    .getByRole("textbox", { name: "Contraseña nueva", exact: true })
    .fill("NuevaSegura2026");
  await page.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill("NuevaSegura2026");
  await page.getByRole("button", { name: "Guardar contraseña nueva" }).click();
  await page.waitForURL((url) => url.pathname === "/paneles");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elegí un sistema");
  expect((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).debeCambiarPassword).toBe(
    false,
  );
});
