import { expect, test } from "./base";

import {
  codigoDe,
  depositoId,
  esMobile,
  loginDueno,
  pistola,
  soltarFoco,
  stock,
  IGNITE_V80,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

const SABOR = "Blue Razz Ice";

test("Transferir desde la fila del stock → flujo nuevo con el sabor precargado, Mover ahora, remito y ledger", async ({
  page,
}) => {
  const [g1, g2] = [
    await stock(IGNITE_V80, SABOR, "Ayres Plaza"),
    await stock(IGNITE_V80, SABOR, "Mercedes"),
  ];
  await loginDueno(page);
  await page.goto(
    `/p/vapes/stock?tab=${await depositoId("Ayres Plaza")}&q=${encodeURIComponent(SABOR)}`,
  );
  await page
    .getByRole("link", { name: `Transferir ${IGNITE_V80} — ${SABOR} a Mercedes` })
    .locator("visible=true")
    .first()
    .click();

  // Arranca en Productos: origen y destino ya elegidos, el sabor cargado con 1.
  await expect(page).toHaveURL(/\/p\/vapes\/stock\/transferencias\/nueva\?/);
  await expect(page.getByTestId("origen-actual")).toHaveText("Ayres Plaza");
  await expect(page.getByTestId("destino-actual")).toHaveText("Mercedes");
  const cantidad = page.getByLabel(`Cantidad de ${IGNITE_V80} — ${SABOR}`);
  await expect(cantidad).toHaveValue("1");
  await cantidad.fill("2");
  await cantidad.blur();
  await page.getByRole("button", { name: "Continuar con 2 unidades" }).click();

  // Confirmar: resumen con marca/modelo/pitadas/sabor/cantidad.
  const resumen = page.getByRole("table", { name: "Resumen de la transferencia" });
  await expect(resumen.getByRole("cell", { name: SABOR })).toBeVisible();
  // Celular: marca, modelo y pitadas van juntas en "Producto".
  await expect(
    resumen.getByRole("columnheader", { name: esMobile(page) ? "Producto" : "Pitadas" }),
  ).toBeVisible();
  await expect(page.getByTestId("total-unidades")).toHaveText("2");
  await page.getByRole("button", { name: "Mover ahora" }).click();

  await expect(page.getByRole("heading", { name: "Moviste 2 unidades" })).toBeVisible();
  await expect(page.getByTestId("codigo-transferencia")).toHaveText(/^VAP-T-\d{6}$/);
  const remito = page.getByTestId("remito-transferencia");
  await expect(remito).toBeVisible();
  const pdf = await page.request.get((await remito.getAttribute("href"))!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );

  await expect.poll(() => stock(IGNITE_V80, SABOR, "Ayres Plaza")).toBe(g1 - 2);
  expect(await stock(IGNITE_V80, SABOR, "Mercedes")).toBe(g2 + 2);

  // La referencia del ledger (el código) abre la transferencia, ya completada.
  await page.goto(`/p/vapes/stock?tab=${await depositoId("Ayres Plaza")}`, {
    waitUntil: "networkidle",
  });
  const referencia = page
    .getByRole("link", { name: /^VAP-T-\d{6}$/ })
    .locator("visible=true")
    .first();
  await expect(referencia).toHaveAttribute("href", /\/p\/vapes\/stock\/transferencias\/[^/?]+$/);
  // Un clic durante la hidratación a veces se pierde: se reintenta hasta navegar.
  await expect(async () => {
    await referencia.click();
    await expect(page).toHaveURL(/\/p\/vapes\/stock\/transferencias\/[^/]+$/, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("Completada").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movimientos generados" })).toBeVisible();
});

test("con pistola: Nueva transferencia → escanear → Registrar envío → Confirmar recepción", async ({
  page,
}) => {
  const SABOR2 = "Grape Ice";
  const codigo = await codigoDe(IGNITE_V80, SABOR2);
  const [g1, g2] = [
    await stock(IGNITE_V80, SABOR2, "Ayres Plaza"),
    await stock(IGNITE_V80, SABOR2, "Mercedes"),
  ];
  expect(g1).toBeGreaterThanOrEqual(3);
  await loginDueno(page);

  // La ruta vieja redirige a la nueva.
  await page.goto("/p/vapes/stock/movimientos/transferencias");
  await expect(page).toHaveURL(/\/p\/vapes\/stock\/transferencias$/);
  await page.getByRole("link", { name: "Nueva transferencia" }).first().click();

  // Paso 1: origen y destino (no pueden ser iguales).
  await page.getByRole("radio", { name: "Origen: Ayres Plaza" }).click();
  await expect(page.getByRole("radio", { name: "Destino: Ayres Plaza" })).toBeDisabled();
  await page.getByRole("radio", { name: "Destino: Mercedes" }).click();
  await page.getByRole("button", { name: "Continuar: Ayres Plaza → Mercedes" }).click();

  // Paso 2: cada lectura suma 1.
  await soltarFoco(page);
  for (let i = 0; i < 3; i++) await pistola(page, codigo);
  await expect(page.getByLabel(`Cantidad de ${IGNITE_V80} — ${SABOR2}`)).toHaveValue("3");
  // Más de lo que hay en origen: la fila se marca y no deja seguir.
  const cantidad = page.getByLabel(`Cantidad de ${IGNITE_V80} — ${SABOR2}`);
  await cantidad.fill(String(g1 + 1));
  await cantidad.blur();
  await expect(page.getByText(/no tiene stock suficiente en el origen/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Continuar con/ })).toBeDisabled();
  await cantidad.fill("3");
  await cantidad.blur();
  await page.getByRole("button", { name: "Continuar con 3 unidades" }).click();

  // Paso 3: registrar el envío (no mueve stock todavía).
  await page.getByLabel("Observación (opcional)").fill("Viaja en el auto");
  await page.getByRole("button", { name: "Registrar envío, confirmar al recibir" }).click();
  await expect(page.getByRole("heading", { name: "Envío de 3 unidades registrado" })).toBeVisible();
  expect(await stock(IGNITE_V80, SABOR2, "Ayres Plaza")).toBe(g1);

  // Detalle: Confirmar recepción mueve el stock.
  await page.getByRole("link", { name: "Ver el detalle de la transferencia" }).click();
  await expect(page.getByText("Pendiente").first()).toBeVisible();
  await expect(page.getByTestId("remito-transferencia")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar recepción" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar recepción" }).click();
  await expect(page.getByText(/Transferencia VAP-T-\d{6} recibida/)).toBeVisible();
  await expect.poll(() => stock(IGNITE_V80, SABOR2, "Ayres Plaza")).toBe(g1 - 3);
  expect(await stock(IGNITE_V80, SABOR2, "Mercedes")).toBe(g2 + 3);
  if (!esMobile(page)) {
    const movs = page.getByRole("table", { name: "Movimientos de stock" });
    await expect(movs.getByText(/^[-−]3$/).first()).toBeVisible();
    await expect(movs.getByText("+3").first()).toBeVisible();
  }
});
