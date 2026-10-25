import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
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

/** Dueño del seed (Juan Cruz). La contraseña la fija el global-setup. */
export const EMAIL_DUENO = "juancruz@negocio.com";
export const loginDueno = (page: Page) => login(page, EMAIL_DUENO, PASSWORD_DUENO);

export const PANEL_VAPES = "pnl_vapes";
export const PANEL_COSMETIC = "pnl_cosmetic";

/** Usuario propio del test (aislado de los demás specs). */
export async function crearUsuario(opciones: {
  rol?: RolUsuario;
  password?: string;
  debeCambiarPassword?: boolean;
  /** Paneles habilitados (EMPLEADO). Default: solo Vapes. */
  paneles?: string[];
  /** Permisos en Vapes (o en `panelId` si se indica). */
  permisos?: {
    modulo: Modulo;
    ver?: boolean;
    crear?: boolean;
    editar?: boolean;
    panelId?: string;
  }[];
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
      paneles:
        (opciones.rol ?? RolUsuario.EMPLEADO) === RolUsuario.EMPLEADO
          ? { create: (opciones.paneles ?? [PANEL_VAPES]).map((panelId) => ({ panelId })) }
          : undefined,
      permisos: {
        create: (opciones.permisos ?? []).map((p) => ({
          panelId: p.panelId ?? PANEL_VAPES,
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

/** Productos del catálogo de ejemplo (e2e/fixtures; nombre completo = marca + modelo + pitadas, lo arma la DB). */
export const IGNITE_V80 = "Ignite V80 8000";
export const ELF_BAR_BC5000 = "Elf Bar BC 5000";
export const ELF_BAR_BC10000 = "Elf Bar BC 10000";
export const CARGADOR = "TechPro Cargador USB-C 20W";

/** Código de barras de un sabor. `producto`: nombre completo; `sabor`: "Único" si no tiene. */
export async function codigoDe(producto: string, sabor: string): Promise<string> {
  const v = await db.variante.findFirstOrThrow({
    where: { panelId: PANEL_VAPES, nombre: sabor, producto: { nombreCompleto: producto } },
  });
  return v.codigoBarras!;
}

export async function stock(producto: string, sabor: string, deposito: string): Promise<number> {
  const s = await db.stock.findFirst({
    where: {
      panelId: PANEL_VAPES,
      variante: { nombre: sabor, producto: { nombreCompleto: producto } },
      deposito: { nombre: deposito },
    },
  });
  return s?.cantidad ?? 0;
}

export async function depositoId(nombre: string): Promise<string> {
  return (await db.deposito.findFirstOrThrow({ where: { panelId: PANEL_VAPES, nombre } })).id;
}

/**
 * Llama a una Server Action por su id (como lo haría alguien con la sesión,
 * salteando la UI). `ruta`: página desde la que "se invoca" (define el panel).
 */
export async function llamarAccion(page: Page, nombre: string, args: unknown, ruta = "/p/vapes") {
  const manifest = JSON.parse(
    readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  ) as {
    node: Record<string, { exportedName?: string }>;
  };
  const id = Object.entries(manifest.node).find(([, v]) => v.exportedName === nombre)?.[0];
  if (!id) throw new Error(`No existe la Server Action ${nombre}`);
  return page.evaluate(
    async ([actionId, a, url]) => {
      const r = await fetch(url, {
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
    [id, args, ruta] as const,
  );
}

/** Espera a que el catálogo offline del panel (Vapes por defecto) esté en IndexedDB. */
export async function esperarCatalogoOffline(page: Page, panelId = PANEL_VAPES) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            new Promise<number>((ok) => {
              const req = indexedDB.open("gestion-offline");
              req.onsuccess = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains("catalogos")) return ok(0);
                const g = d.transaction("catalogos").objectStore("catalogos").get(id);
                g.onsuccess = () =>
                  ok((g.result as { cantidad?: number } | undefined)?.cantidad ?? 0);
              };
              req.onerror = () => ok(0);
            }),
          panelId,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

export const esMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/**
 * GET a un PDF del sistema: 200, `application/pdf`, inline y empieza con
 * "%PDF-". Devuelve los bytes. `pedido`: page.request (con la sesión) o un
 * contexto sin cookies (links públicos de WhatsApp).
 */
export async function esperarPdf(pedido: APIRequestContext, url: string): Promise<Buffer> {
  const r = await pedido.get(url);
  expect(r.status(), `GET ${url}`).toBe(200);
  expect(r.headers()["content-type"]).toBe("application/pdf");
  expect(r.headers()["content-disposition"]).toMatch(/^inline; filename=".+\.pdf"$/);
  const pdf = await r.body();
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  return pdf;
}

/** El link "PDF: https://…" / "Remito: https://…" de un texto de WhatsApp, como ruta. */
export function linkPublicoPdf(textoWhatsApp: string): string {
  const m = /https?:\/\/[^\s/]+(\/api\/publico\/pdf\/[^\s]+)/.exec(textoWhatsApp);
  if (!m) throw new Error(`El texto no tiene link al PDF: ${textoWhatsApp}`);
  return m[1]!;
}

/** Dibuja una firma (una curva) en el canvas con el mouse / el dedo. */
export async function firmarEnCanvas(page: Page, canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  const x0 = b.x + b.width * 0.12;
  const y0 = b.y + b.height * 0.65;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(
      x0 + t * b.width * 0.75,
      y0 - Math.sin(t * Math.PI * 2.5) * b.height * 0.3,
      { steps: 2 },
    );
  }
  await page.mouse.up();
}

/** Mails del transporte de prueba (MAIL_TRANSPORTE=prueba → .mails-e2e/*.json), del más viejo al más nuevo. */
export function mailsPara(email: string): { subject: string; text: string; html?: string }[] {
  const dir = ".mails-e2e";
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map(
      (f) =>
        JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
          subject: string;
          text: string;
          html?: string;
          to: { address: string }[];
        },
    )
    .filter((m) => m.to.some((t) => t.address === email));
}

/** Código de 6 dígitos del último mail «… es tu código para cambiar la contraseña». */
export async function codigoDelMail(email: string, distintoDe?: string): Promise<string> {
  let codigo = "";
  await expect
    .poll(() => {
      const ultimo = mailsPara(email)
        .filter((m) => /es tu código para cambiar la contraseña/.test(m.subject))
        .at(-1);
      codigo = /^(\d{6}) /.exec(ultimo?.subject ?? "")?.[1] ?? "";
      return codigo !== "" && codigo !== distintoDe;
    })
    .toBe(true);
  return codigo;
}
