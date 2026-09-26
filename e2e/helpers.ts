import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { Modulo, RolUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";

import { db } from "./db";
import { PASSWORD_DUENO } from "./global-setup";

export { db, PASSWORD_DUENO };

export async function login(page: Page, email: string, password: string) {
  if (process.env.E2E_CONSOLA) {
    page.on(
      "console",
      (m) =>
        ["error", "warning"].includes(m.type()) &&
        !/preload/.test(m.text()) &&
        console.log(`[consola ${m.type()} ${page.url()}]`, m.text().slice(0, 1500)),
    );
    page.on("pageerror", (e) => console.log(`[pageerror ${page.url()}]`, e.message.slice(0, 800)));
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: /ingresar/i }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.waitForLoadState("networkidle");
}

export const loginDueno = (page: Page) => login(page, "dueno1@negocio.com", PASSWORD_DUENO);

/** Usuario propio del test (aislado de los demás specs). */
export async function crearUsuario(opciones: {
  rol?: RolUsuario;
  password?: string;
  debeCambiarPassword?: boolean;
  permisos?: { modulo: Modulo; ver?: boolean; crear?: boolean; editar?: boolean }[];
}) {
  const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const password = opciones.password ?? "Probando2026x";
  const u = await db.usuario.create({
    data: {
      nombre: `E2E ${sufijo}`,
      email: `e2e-${sufijo}@negocio.com`,
      rol: opciones.rol ?? RolUsuario.EMPLEADO,
      passwordHash: await bcrypt.hash(password, 10),
      debeCambiarPassword: opciones.debeCambiarPassword ?? false,
      permisos: {
        create: (opciones.permisos ?? []).map((p) => ({
          modulo: p.modulo,
          puedeVer: p.ver ?? true,
          puedeCrear: p.crear ?? false,
          puedeEditar: p.editar ?? false,
        })),
      },
    },
  });
  return { ...u, password };
}

/** Saca el foco de cualquier input (la pistola escribe "en el aire", como en el galpón). */
export async function soltarFoco(page: Page) {
  // Página hidratada (el listener global de la pistola ya está puesto).
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Pistola lectora simulada: teclas reales cada 10 ms + Enter (un keyboard wedge). */
export async function pistola(page: Page, codigo: string) {
  await page.keyboard.type(codigo, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
}

export async function codigoDe(producto: string, variante: string): Promise<string> {
  const v = await db.variante.findFirstOrThrow({
    where: { nombre: variante, producto: { nombre: producto } },
  });
  return v.codigoBarras!;
}

export async function stock(producto: string, variante: string, deposito: string): Promise<number> {
  const s = await db.stock.findFirst({
    where: {
      variante: { nombre: variante, producto: { nombre: producto } },
      deposito: { nombre: deposito },
    },
  });
  return s?.cantidad ?? 0;
}

export async function depositoId(nombre: string): Promise<string> {
  return (await db.deposito.findFirstOrThrow({ where: { nombre } })).id;
}

/** Llama a una Server Action por su id (como lo haría alguien con la sesión, salteando la UI). */
export async function llamarAccion(page: Page, nombre: string, args: unknown) {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  ) as {
    node: Record<string, { exportedName?: string }>;
  };
  const id = Object.entries(manifest.node).find(([, v]) => v.exportedName === nombre)?.[0];
  if (!id) throw new Error(`No existe la Server Action ${nombre}`);
  return page.evaluate(
    async ([actionId, a]) => {
      const r = await fetch("/", {
        method: "POST",
        headers: {
          "Next-Action": actionId,
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        body: JSON.stringify([a]),
      });
      return (await r.text()).split("\n").find((l) => l.includes('"ok"')) ?? "";
    },
    [id, args] as const,
  );
}

export async function esperarCatalogoOffline(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((ok) => {
              const req = indexedDB.open("gestion-offline");
              req.onsuccess = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains("meta")) return ok(0);
                const g = d.transaction("meta").objectStore("meta").get("catalogo");
                g.onsuccess = () =>
                  ok((g.result as { cantidad?: number } | undefined)?.cantidad ?? 0);
              };
              req.onerror = () => ok(0);
            }),
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

export const esMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
