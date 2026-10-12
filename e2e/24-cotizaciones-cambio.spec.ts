import { expect, test } from "./base";

import { PASSWORD_TRINIDAD } from "./global-setup";
import { db, login, loginDueno } from "./helpers";

/**
 * Cotizaciones de moneda (globales): el setup siembra blue 1.300 y USDT 1.350
 * (la suite corre sin APIs externas). Un override manual pisa al automático
 * en la pantalla y en el widget de la barra del panel.
 */
test("dueño: ve blue y USDT con fuente; override manual en el widget; quitar override", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "cambia una cotización global");
  await loginDueno(page);
  await page.goto("/configuracion/cambio");
  await expect(page.getByRole("heading", { name: "Cotizaciones", level: 1 })).toBeVisible();
  const blue = page.getByTestId("cotizacion-USD_BLUE");
  await expect(blue).toContainText("$ 1.300");
  await expect(blue).toContainText("e2e");
  await expect(page.getByTestId("cotizacion-USDT")).toContainText("$ 1.350");

  await page.getByLabel("Valor manual de Dólar blue").fill("1500");
  await page
    .getByTestId("cotizacion-USD_BLUE")
    .locator("xpath=..")
    .getByRole("button", { name: "Usar este valor" })
    .click();
  await expect(blue).toContainText("$ 1.500");
  await expect(blue).toContainText("Cargada a mano por Juan Cruz");

  await page.goto("/p/vapes");
  const widget = page.getByTestId("widget-cambio");
  await expect(widget).toContainText("Blue");
  await expect(widget).toContainText("$ 1.500");
  await expect(widget).toContainText("$ 1.350");

  await page.goto("/configuracion/cambio");
  await page.getByRole("button", { name: "Quitar override" }).click();
  // "$ 1.300" también figura en el historial: esperar a que desaparezca el override.
  await expect(blue).not.toContainText("Cargada a mano");
  await expect(blue).toContainText("$ 1.300");
  await expect
    .poll(() => db.configuracionGlobal.findUnique({ where: { clave: "cambio.overrideUSD_BLUE" } }))
    .toBeNull();
});

test("widget en la barra del panel: dueño con link a la configuración", async ({ page }) => {
  await loginDueno(page);
  await page.goto("/p/vapes");
  await expect(page.getByTestId("widget-cambio")).toBeVisible();
  await expect(page.getByTestId("widget-cambio")).toHaveAttribute("href", "/configuracion/cambio");
});

test("widget: Trinidad lo ve solo si ve el Cotizador, y sin link", async ({ page }) => {
  const trinidad = await db.usuario.findFirstOrThrow({
    where: { nombre: "Trinidad" },
    include: { permisos: { where: { modulo: "COTIZADOR" } } },
  });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  const widget = page.getByTestId("widget-cambio");
  if (trinidad.permisos.some((p) => p.puedeVer)) {
    await expect(widget).toBeVisible();
    await expect(widget).not.toHaveAttribute("href", /.*/);
  } else {
    await expect(widget).toHaveCount(0);
  }
});

test("cron /api/cron/cambio sin secreto → 401", async ({ request }) => {
  const r = await request.get("/api/cron/cambio");
  expect(r.status()).toBe(401);
});
