import { expect, test } from "./base";

import { crearUsuario, db, login, loginDueno } from "./helpers";

test("el dueño cierra las sesiones de un empleado: su próximo request lo manda al login", async ({
  page,
  browser,
}) => {
  const u = await crearUsuario({ permisos: [{ modulo: "STOCK" }] });

  // El empleado, en "su celular" (otro contexto de navegador).
  const celular = await browser.newContext();
  const empleado = await celular.newPage();
  await login(empleado, u.email, u.password);
  await empleado.goto("/p/vapes/stock");
  await expect(empleado).toHaveURL(/\/p\/vapes\/stock/);
  expect(await db.sesion.count({ where: { usuarioId: u.id, revocadaAt: null } })).toBe(1);

  // El dueño le cierra las sesiones desde Usuarios.
  await loginDueno(page);
  await page.goto("/usuarios");
  await page
    .getByRole("button", { name: `Cerrar sesiones de ${u.nombre}` })
    .locator("visible=true")
    .first()
    .click();
  await page.getByRole("button", { name: "Cerrar sesiones", exact: true }).click();
  await expect
    .poll(() => db.sesion.count({ where: { usuarioId: u.id, revocadaAt: null } }))
    .toBe(0);

  // Siguiente navegación del empleado: afuera, aunque su cookie siga "vigente".
  await empleado.goto("/p/vapes/stock");
  await expect(empleado).toHaveURL(/\/login/);
  expect(
    await db.auditLog.count({ where: { entidadId: u.id, accion: "SESION_REVOCADA" } }),
  ).toBeGreaterThan(0);
  await celular.close();
});

test("la ayuda (manual de usuario) está disponible para cualquier usuario", async ({ page }) => {
  const u = await crearUsuario({ permisos: [] });
  await login(page, u.email, u.password);
  await page.goto("/ayuda");
  await expect(page.getByRole("heading", { name: "Ayuda", level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Índice del manual" })
      .getByRole("link", { name: "Configurar la pistola lectora" }),
  ).toBeVisible();
});
