import type { Page } from "@playwright/test";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  codigoDe,
  db,
  IGNITE_V80,
  login,
  loginDueno,
  PANEL_VAPES,
  pistola,
  soltarFoco,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * "Verificar con pistola" (paso Productos del modal de venta): cada escaneo se
 * compara contra el carrito por sabor exacto; lo que no corresponde frena con
 * un aviso; la venta queda marcada "Verificada" solo si se escanearon todas.
 */
test.describe.configure({ mode: "serial" });

const modal = (page: Page) => page.getByTestId("modal-venta");
const filas = (page: Page) => modal(page).locator('ul[aria-label="Productos de la venta"] > li');
const interruptor = (page: Page) =>
  modal(page).getByRole("switch", { name: "Verificar con pistola" });

async function abrirEnAyres(page: Page) {
  await page.goto("/p/vapes/ventas");
  await page.getByRole("button", { name: "Generar venta" }).click();
  await expect(modal(page)).toBeVisible();
  await modal(page)
    .getByRole("radio", { name: /Ayres Plaza/ })
    .click();
  await modal(page).getByRole("button", { name: "Continuar con Ayres Plaza" }).click();
  await soltarFoco(page);
}

/** Carga 2 Mango a mano (buscador) y activa el modo verificar. */
async function carritoConDosMango(page: Page) {
  const buscador = modal(page).getByPlaceholder(/Escaneá o buscá producto/);
  await buscador.fill("Mango Ice");
  await page.getByRole("option", { name: new RegExp(`${IGNITE_V80}.*Mango Ice`) }).click();
  await expect(filas(page)).toHaveCount(1);
  await modal(page)
    .getByRole("button", { name: `Sumar uno de ${IGNITE_V80} — Mango Ice` })
    .click();
  await expect(modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("2");
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await soltarFoco(page);
}

test("verificar con pistola: Frutilla no corresponde, Mango 2/2, el tercero avisa y la venta queda Verificada", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const frutilla = await codigoDe(IGNITE_V80, "Strawberry Watermelon");
  await loginDueno(page);
  await abrirEnAyres(page);

  // Sin ítems el modo no se puede activar.
  await expect(interruptor(page)).toBeDisabled();
  await carritoConDosMango(page);
  await expect(modal(page).getByTestId("verificadas")).toHaveText("verificadas 0/2");

  // (c) Otro sabor del mismo modelo: aviso bloqueante con la identidad completa.
  await pistola(page, frutilla);
  const aviso = page.getByTestId("aviso-no-corresponde");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(`${IGNITE_V80} — Strawberry Watermelon`);
  await expect(aviso).toContainText(frutilla);
  await expect(aviso).toContainText(`2 × ${IGNITE_V80} — Mango Ice`);
  // Bloqueante: mientras está abierto, la pistola no verifica nada.
  await pistola(page, mango);
  await expect(modal(page).getByTestId("verificadas")).toHaveText("verificadas 0/2");
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(aviso).toBeHidden();
  await expect(filas(page)).toHaveCount(1);
  await soltarFoco(page);

  // (a) Mango dos veces → 2/2, con la identidad en grande.
  await pistola(page, mango);
  const identidad = modal(page).getByTestId("identidad-escaneo");
  await expect(identidad).toContainText("Mango Ice");
  await expect(identidad).toContainText("Ignite");
  await expect(identidad).toContainText("8000");
  await expect(identidad).toContainText(mango);
  await expect(modal(page).getByTestId("verificadas")).toHaveText("verificadas 1/2");
  await pistola(page, mango);
  await expect(modal(page).getByTestId("verificadas")).toHaveText("verificadas 2/2");
  await expect(modal(page).getByTestId("resumen-verificacion")).toHaveText(
    "Todas las unidades verificadas.",
  );

  // (b) Tercera vez: ya están todas.
  await pistola(page, mango);
  await expect(modal(page).getByRole("alert").filter({ hasText: "Ya verificaste" })).toHaveText(
    "Ya verificaste las 2 unidades de Mango Ice",
  );
  await expect(modal(page).getByLabel(`Cantidad de ${IGNITE_V80} — Mango Ice`)).toHaveValue("2");

  // Todo verificado: Continuar pasa directo al cliente.
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("button", { name: "Sí", exact: true }).click();
  await modal(page).getByLabel("Nombre").fill("Vero Verificada");
  await modal(page)
    .getByLabel("Teléfono")
    .fill(`11 6${Date.now().toString().slice(-7)}`);
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await modal(page).getByRole("radio", { name: "Efectivo" }).click();
  await modal(page).getByRole("button", { name: "Confirmar venta" }).click();
  const id = modal(page).getByTestId("id-venta");
  await expect(id).toHaveText(/^VAP-\d{6}$/, { timeout: 20_000 });
  const codigo = (await id.textContent())!;
  const venta = await db.venta.findFirstOrThrow({ where: { panelId: PANEL_VAPES, codigo } });
  expect(venta.verificadaPorEscaneo).toBe(true);

  // Badge en el detalle y en el listado.
  await page.goto(`/p/vapes/ventas/${venta.id}`);
  await expect(page.getByText("Verificada", { exact: true })).toBeVisible();
  await page.goto("/p/vapes/ventas");
  await expect(
    page.getByRole("row").filter({ hasText: codigo }).getByText("Verificada", { exact: true }),
  ).toBeVisible();
});

test("faltan unidades: Continuar pide confirmación explícita (no bloquea); Trinidad también verifica", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-desktop", "flujo de escritorio");
  const mango = await codigoDe(IGNITE_V80, "Mango Ice");
  const trinidad = await db.usuario.findFirstOrThrow({ where: { nombre: "Trinidad" } });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await abrirEnAyres(page);
  await carritoConDosMango(page);
  await pistola(page, mango);
  await expect(modal(page).getByTestId("verificadas")).toHaveText("verificadas 1/2");

  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  const confirmacion = page.getByRole("dialog", { name: "Faltan verificar 1 unidad" });
  await expect(confirmacion).toBeVisible();
  await confirmacion.getByRole("button", { name: "Seguir verificando" }).click();
  await expect(confirmacion).toBeHidden();
  await modal(page).getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Faltan verificar 1 unidad" })
    .getByRole("button", { name: "Continuar igual" })
    .click();
  await expect(modal(page).getByRole("button", { name: "Sí", exact: true })).toBeVisible();
});
