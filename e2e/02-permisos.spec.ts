import { expect, test } from "./base";

import { crearUsuario, db, llamarAccion, login } from "./helpers";

test("empleado sin permiso: navegación filtrada, /usuarios → /sin-acceso, Server Action → Forbidden", async ({
  page,
}) => {
  const u = await crearUsuario({
    permisos: [{ modulo: "VENTAS", crear: true }, { modulo: "INVENTARIO" }],
  });
  await login(page, u.email, u.password);
  await page.goto("/");

  // Navegación: solo lo que puede ver (en mobile, dentro de «Más»).
  const nav = page.locator('aside, nav[aria-label="Navegación inferior"]');
  await expect(nav.locator('a[href="/usuarios"]')).toHaveCount(0);
  await expect(nav.locator('a[href="/reportes"]')).toHaveCount(0);
  await expect(nav.locator('a[href^="/ventas"]').locator("visible=true").first()).toBeVisible();

  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/sin-acceso$/);

  // Una Server Action de dueño, invocada directo con su sesión: Forbidden.
  const antes = await db.usuario.count();
  const r = await llamarAccion(page, "crearUsuarioAction", {
    nombre: "Colado",
    email: `colado-${Date.now()}@x.com`,
    rol: "OWNER",
    password: "Colado2026x",
  });
  expect(r).toContain('"ok":false');
  expect(r).toContain("FORBIDDEN");
  expect(await db.usuario.count()).toBe(antes);
  // Y quedó en la auditoría como acceso denegado.
  expect(
    await db.auditLog.count({ where: { usuarioId: u.id, accion: "ACCESO_DENEGADO" } }),
  ).toBeGreaterThan(0);
});
