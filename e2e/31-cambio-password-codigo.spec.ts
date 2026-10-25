import { mkdirSync } from "node:fs";

import type { Page } from "@playwright/test";
import bcrypt from "bcryptjs";

import { expect, test } from "./base";
import { PASSWORD_CHARLY } from "./global-setup";
import {
  codigoDelMail,
  crearUsuario,
  db,
  esMobile,
  llamarAccion,
  login,
  loginDueno,
  mailsPara,
} from "./helpers";

/**
 * Cambio de contraseña con código por mail (A3, bloque 6): «Enviar código» →
 * el código llega por mail (transporte de prueba: .mails-e2e) → incorrecto /
 * correcto → contraseña nueva con requisitos → se cierran las OTRAS sesiones
 * y llega el aviso. Además: sin verificar, la acción no deja cambiarla (ni
 * el camino viejo con la actual), y el dueño sigue pudiendo resetear desde
 * /usuarios/[id].
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/a3";

async function captura(page: Page, nombre: string) {
  mkdirSync(CARPETA, { recursive: true });
  const movil = esMobile(page);
  const antes = page.viewportSize();
  if (movil) await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: `${CARPETA}/password-${nombre}-${movil ? "375" : "1440"}.png`,
    fullPage: true,
  });
  if (movil && antes) await page.setViewportSize(antes);
}

test("cambio de contraseña con código por mail: cierra las otras sesiones y avisa", async ({
  page,
  browser,
}) => {
  const u = await crearUsuario({ password: "Anterior2026x" });
  const NUEVA = "Lunes-de-sol-2026";

  // Otro dispositivo con la sesión abierta.
  const otro = await browser.newContext();
  const otraPagina = await otro.newPage();
  await login(otraPagina, u.email, u.password);

  await login(page, u.email, u.password);
  await page.goto("/cuenta");
  const tarjeta = page.locator("section", { hasText: "Cambiar contraseña" }).last();
  await expect(tarjeta.getByText("Con un código que te mandamos por mail")).toBeVisible();
  await captura(page, "1-inicio");

  // Sin verificar, la acción de cambio no deja (el cliente no puede saltar el paso)…
  expect(
    await llamarAccion(
      page,
      "cambiarPasswordConCodigoAction",
      { token: "x".repeat(43), passwordNueva: NUEVA, confirmacion: NUEVA },
      "/cuenta",
    ),
  ).toContain("VERIFICACION_VENCIDA");
  // …ni el camino viejo con la contraseña actual (hay mail configurado).
  expect(
    await llamarAccion(
      page,
      "cambiarPasswordAction",
      { passwordActual: u.password, passwordNueva: NUEVA, confirmacion: NUEVA },
      "/cuenta",
    ),
  ).toContain("FORBIDDEN");

  // 1. Enviar código.
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByText("Te mandamos el código a")).toBeVisible();
  const codigo = await codigoDelMail(u.email);
  const mail = mailsPara(u.email).at(-1)!;
  expect(mail.text).toContain("Vence en 10 minutos");
  expect(mail.text).toContain("Si no fuiste vos, ignoralo");
  // Reenviar recién después de 60 s.
  await expect(page.getByRole("button", { name: /Reenviar en \d+ s/ })).toBeDisabled();
  await captura(page, "2-codigo");

  // 2. Incorrecto → avisa los intentos; correcto → paso 3.
  const malo = String((Number(codigo) + 1) % 1_000_000).padStart(6, "0");
  await page.getByLabel("Código de 6 dígitos").fill(malo);
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByText("El código no es correcto. Te quedan 4 intentos.")).toBeVisible();
  await captura(page, "3-incorrecto");
  await page.getByLabel("Código de 6 dígitos").fill(codigo);
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByText("Código verificado")).toBeVisible();

  // 3. Contraseña nueva con requisitos en vivo.
  const requisitos = page.getByTestId("requisitos-password");
  await page.getByRole("textbox", { name: "Contraseña nueva", exact: true }).fill("clave");
  await expect(requisitos.getByText("Débil")).toBeVisible();
  await expect(requisitos.getByRole("listitem").filter({ hasText: "(falta)" })).toHaveCount(3);
  await page.getByRole("textbox", { name: "Contraseña nueva", exact: true }).fill(NUEVA);
  await page.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill(NUEVA);
  await expect(requisitos.getByText("Muy buena")).toBeVisible();
  await expect(requisitos.getByRole("listitem").filter({ hasText: "(cumple)" })).toHaveCount(4);
  await captura(page, "4-nueva");
  await page.getByRole("button", { name: "Guardar contraseña nueva" }).click();
  await expect(page.getByText("Listo: tu contraseña se cambió.")).toBeVisible();
  await expect(page.getByText("Cerramos tu sesión en 1 dispositivo más")).toBeVisible();
  await captura(page, "5-listo");

  // Guardada con bcrypt, aviso por mail, auditoría.
  const guardado = await db.usuario.findUniqueOrThrow({ where: { id: u.id } });
  expect(await bcrypt.compare(NUEVA, guardado.passwordHash)).toBe(true);
  await expect.poll(() => mailsPara(u.email).some((m) => /se cambió/.test(m.subject))).toBe(true);
  expect(
    await db.auditLog.count({
      where: {
        usuarioId: u.id,
        entidadId: u.id,
        datosDespues: { path: ["metodo"], equals: "codigo_mail" },
      },
    }),
  ).toBe(1);

  // Este dispositivo sigue adentro; el otro quedó afuera.
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(
    page.locator("section", { hasText: "Sesiones abiertas" }).getByRole("listitem"),
  ).toHaveCount(1);
  await otraPagina.goto("/cuenta");
  await expect(otraPagina).toHaveURL(/\/login/);

  // Con la vieja ya no entra; con la nueva sí.
  await otraPagina.getByLabel("Email").fill(u.email);
  await otraPagina.getByLabel("Contraseña", { exact: true }).fill(u.password);
  await otraPagina.getByRole("button", { name: /ingresar/i }).click();
  await expect(otraPagina.getByText(/Credenciales inválidas|incorrect/i)).toBeVisible();
  await login(otraPagina, u.email, NUEVA);
  await expect(otraPagina).not.toHaveURL(/\/login/);
  await otro.close();
});

test("el dueño sigue reseteando la contraseña desde /usuarios/[id]", async ({ page, browser }) => {
  const u = await crearUsuario({ password: "Empleado2026x" });
  await loginDueno(page);
  await page.goto(`/usuarios/${u.id}`);
  await page.getByRole("button", { name: "Resetear contraseña" }).click();
  await page.getByRole("button", { name: "Resetear", exact: true }).click();
  const temporal = (await page.getByTestId("password-temporal").textContent())?.trim() ?? "";
  expect(temporal).toMatch(/^[A-Za-z0-9]{12}$/);
  await captura(page, "6-reset-dueno");
  await page.getByRole("button", { name: "Listo, ya la copié" }).click();
  await expect(page.getByText("Temporal", { exact: true })).toBeVisible();

  // Con la temporal, a /cuenta y el mismo flujo con código.
  const ctx = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    isMobile: esMobile(page),
    hasTouch: esMobile(page),
  });
  const emp = await ctx.newPage();
  await login(emp, u.email, temporal);
  await expect(emp).toHaveURL(/\/cuenta$/);
  await expect(emp.getByText("Tenés que cambiar tu contraseña para continuar.")).toBeVisible();
  await emp.getByRole("button", { name: "Enviar código" }).click();
  await emp.getByLabel("Código de 6 dígitos").fill(await codigoDelMail(u.email));
  await emp.getByRole("button", { name: "Verificar código" }).click();
  await emp.getByRole("textbox", { name: "Contraseña nueva", exact: true }).fill("Martes-2026-sol");
  await emp.getByRole("textbox", { name: "Repetir contraseña nueva" }).fill("Martes-2026-sol");
  await emp.getByRole("button", { name: "Guardar contraseña nueva" }).click();
  await emp.waitForURL((url) => url.pathname !== "/cuenta");
  expect((await db.usuario.findUniqueOrThrow({ where: { id: u.id } })).debeCambiarPassword).toBe(
    false,
  );
  await ctx.close();
});

test("Charly (perfil Escaneo) también pide el código desde /cuenta", async ({ page }) => {
  const charly = await db.usuario.findUniqueOrThrow({ where: { email: "charly@negocio.com" } });
  // Cada proyecto (escritorio / celular) arranca sin la espera de 60 s del anterior.
  await db.codigoVerificacion.deleteMany({ where: { usuarioId: charly.id } });
  await login(page, charly.email, PASSWORD_CHARLY);
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/cuenta$/);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByText("Te mandamos el código a")).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill(await codigoDelMail(charly.email));
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByText("Código verificado")).toBeVisible();
});
