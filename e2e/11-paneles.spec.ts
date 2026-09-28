import { expect, test } from "./base";

import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, login, loginDueno } from "./helpers";

test("Trinidad (solo Vapes): entra directo a Vapes; otro panel → selector con aviso; /usuarios → sin acceso", async ({
  page,
}) => {
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await expect(page).toHaveURL(/\/p\/vapes$/);

  // Escribiendo a mano la URL de otro sistema: vuelve al selector con el aviso.
  await page.goto("/p/cosmetic/productos");
  await expect(page.getByText("No tenés acceso a ese panel")).toBeVisible();
  // …y como solo tiene uno, el selector la devuelve a Vapes.
  await expect(page).toHaveURL(/\/p\/vapes$/);

  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/sin-acceso$/);

  // Las APIs de otro panel también se rechazan (el panel sale de la URL).
  const r = await page.evaluate(
    async () => (await fetch("/api/p/cosmetic/catalogo/offline")).status,
  );
  expect(r).toBe(403);
});

test("Juan Cruz: selector con los 3 sistemas y «Agregar panel»; crea «Prueba» y lo desactiva", async ({
  page,
}, info) => {
  // Crea un panel real (único por nombre y prefijo): corre una sola vez, en escritorio.
  test.skip(info.project.name !== "chromium-desktop", "crea datos únicos");
  await loginDueno(page);
  await expect(page).toHaveURL(/\/paneles$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Qué sistema querés abrir?");
  for (const nombre of ["Vapes", "Cosmetic", "Especiales"]) {
    await expect(page.getByRole("heading", { name: nombre, level: 2 })).toBeVisible();
  }
  await page.getByRole("button", { name: /Agregar panel/ }).click();
  await page.getByLabel("Nombre").fill("Prueba");
  await expect(page.getByText("IDs de venta: PRU-000001")).toBeVisible();
  await page.getByLabel("Atributo principal de los productos").fill("Detalle");
  await page.getByRole("button", { name: "Crear panel" }).click();
  await page.waitForURL(/\/p\/prueba$/);

  const panel = await db.panel.findUniqueOrThrow({
    where: { slug: "prueba" },
    include: { depositos: true, secuencias: true },
  });
  expect(panel.depositos.map((d) => [d.nombre, d.esPrincipal])).toEqual([["Principal", true]]);
  expect(panel.secuencias.map((s) => s.entidad).sort()).toEqual([
    "COMPRA",
    "COTIZACION",
    "DEVOLUCION",
    "TRANSFERENCIA",
    "VENTA",
  ]);

  await page.goto("/paneles");
  await expect(page.getByRole("heading", { name: "Prueba", level: 2 })).toBeVisible();

  // Baja (soft): deja de aparecer y de ser accesible; sus datos quedan.
  await page.goto("/configuracion/sistemas");
  await page
    .getByRole("listitem")
    .filter({ hasText: "/p/prueba" })
    .getByRole("button", { name: "Desactivar" })
    .click();
  await page.getByRole("button", { name: "Desactivar", exact: true }).last().click();
  await expect(page.getByText("Prueba desactivado")).toBeVisible();
  expect((await db.panel.findUniqueOrThrow({ where: { slug: "prueba" } })).activo).toBe(false);
  await page.goto("/paneles");
  await expect(page.getByRole("heading", { name: "Prueba", level: 2 })).toHaveCount(0);
});
