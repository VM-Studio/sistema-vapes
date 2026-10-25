import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";
import sharp from "sharp";

import { formatearPesos } from "../src/lib/format";
import { mesDe, nombreMes, sumarMeses } from "../src/lib/ganancia-vendedor";

import { expect, test } from "./base";
import { PASSWORD_TRINIDAD } from "./global-setup";
import {
  db,
  esMobile,
  esperarPdf,
  firmarEnCanvas,
  login,
  loginDueno,
  PANEL_VAPES,
} from "./helpers";
import { usarCatalogoEjemplo } from "./fixtures";

usarCatalogoEjemplo();

/**
 * Pago de la liquidación con remito firmado (A3, bloque 2): el dueño registra
 * el pago firmando en el canvas → el remito le llega a Trinidad por mail
 * (transporte de prueba: queda en .mails-e2e) con el link → Trinidad abre
 * /firma/{token} sin sesión, firma y toca «Firmado» → la liquidación queda
 * Firmada con las dos firmas y el remito final les llega a los dueños.
 * Además: Trinidad logueada firma desde su usuario.
 */
test.describe.configure({ mode: "serial" });

const CARPETA = "verificacion/a3";
const MAILS = ".mails-e2e";
const MES = mesDe(new Date());
const MES_ANTERIOR = sumarMeses(MES, -1);
const MES_TRAS_ANTERIOR = sumarMeses(MES, -2);
const n = `${Date.now()}`.slice(-6);
let trinidad: { id: string; email: string; nombre: string };
let tarifaCreada: Date | null = null;
let linkFirma = "";

interface MailPrueba {
  subject: string;
  text: string;
  to: { address: string }[];
  replyTo?: { address: string }[];
  attachments?: { filename: string; content: string; encoding?: string }[];
}

function mails(): MailPrueba[] {
  if (!existsSync(MAILS)) return [];
  return readdirSync(MAILS)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(MAILS, f), "utf8")) as MailPrueba);
}

async function captura(page: Page, nombre: string) {
  mkdirSync(CARPETA, { recursive: true });
  const movil = esMobile(page);
  const antes = page.viewportSize();
  if (movil) await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: `${CARPETA}/trinidad-${nombre}-${movil ? "375" : "1440"}.png`,
    fullPage: true,
  });
  if (movil && antes) await page.setViewportSize(antes);
}

/** Venta confirmada de Trinidad directo en la base (como 20-dashboard). */
async function venta(fecha: Date, cantidad: number) {
  const [variante, deposito] = await Promise.all([
    db.variante.findFirstOrThrow({
      where: { panelId: PANEL_VAPES, deletedAt: null },
      orderBy: { sku: "asc" },
    }),
    db.deposito.findFirstOrThrow({ where: { panelId: PANEL_VAPES, esPrincipal: true } }),
  ]);
  const total = 10000 * cantidad;
  await db.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({
      data: {
        panelId: PANEL_VAPES,
        nombre: `Cliente remito ${n}-${cantidad}`,
        telefono: `+5411${n}${String(cantidad).padStart(2, "0")}`,
      },
    });
    const s = await tx.secuencia.update({
      where: { panelId_entidad: { panelId: PANEL_VAPES, entidad: "VENTA" } },
      data: { ultimoNumero: { increment: 1 } },
    });
    await tx.venta.create({
      data: {
        panelId: PANEL_VAPES,
        numero: s.ultimoNumero,
        codigo: `VAP-${String(s.ultimoNumero).padStart(6, "0")}`,
        fecha,
        clienteId: cliente.id,
        depositoId: deposito.id,
        vendedorId: trinidad.id,
        tipo: "UNITARIA",
        medioPago: "EFECTIVO",
        montoPagado: total,
        pagos: {
          create: {
            panelId: PANEL_VAPES,
            medioPago: "EFECTIVO",
            monto: total,
            fecha,
            usuarioId: trinidad.id,
          },
        },
        subtotal: total,
        total,
        costoTotal: 0,
        gananciaBruta: total,
        items: {
          create: {
            panelId: PANEL_VAPES,
            varianteId: variante.id,
            productoId: variante.productoId,
            cantidad,
            precioLista: 10000,
            precioUnitario: 10000,
            costoUnitario: 0,
            subtotal: total,
          },
        },
      },
    });
  });
}

test.beforeAll(async () => {
  trinidad = await db.usuario.findFirstOrThrow({
    where: { nombre: "Trinidad" },
    select: { id: true, email: true, nombre: true },
  });
  const tarifa = await db.tarifaVendedor.findUniqueOrThrow({
    where: { panelId_usuarioId: { panelId: PANEL_VAPES, usuarioId: trinidad.id } },
  });
  tarifaCreada = tarifa.createdAt;
  await db.tarifaVendedor.update({
    where: { id: tarifa.id },
    data: { createdAt: new Date(`${MES_ANTERIOR}-01T12:00:00Z`) },
  });
  // Mes anterior: 3 vapes minoristas → $ 4.500 (se liquida solo al abrir la pantalla).
  await venta(new Date(`${MES_ANTERIOR}-15T15:00:00Z`), 3);
});

test.afterAll(async () => {
  if (tarifaCreada)
    await db.tarifaVendedor.updateMany({
      where: { panelId: PANEL_VAPES, usuarioId: trinidad.id },
      data: { createdAt: tarifaCreada },
    });
});

test("el dueño registra el pago firmando y el remito le llega a Trinidad por mail", async ({
  page,
}) => {
  const antes = mails().length;
  await loginDueno(page);
  await page.goto(`/p/vapes/equipo/${trinidad.id}?mes=${MES_ANTERIOR}`);
  const estado = page.getByTestId("estado-liquidacion");
  await expect(estado).toContainText("Pendiente de pago");
  await estado.getByRole("button", { name: "Registrar pago" }).click();
  const hoja = page.getByRole("dialog", { name: "Pago a Trinidad" });
  await expect(hoja.getByLabel("Monto pagado")).toHaveValue("4500");
  await hoja.getByLabel("Cómo se le pagó").selectOption("TRANSFERENCIA");
  // Sin firma no deja.
  await hoja.getByRole("button", { name: "Firmar y registrar pago" }).click();
  await expect(hoja).toContainText("Firmá el remito antes de confirmar");
  await firmarEnCanvas(page, hoja.getByTestId("firma-canvas"));
  await captura(page, "registrar-pago-firma");
  await hoja.getByRole("button", { name: "Firmar y registrar pago" }).click();

  const dialogo = page.getByRole("dialog", { name: "Remito enviado por mail" });
  await expect(dialogo).toContainText(`Se mandó a ${trinidad.email}`);
  linkFirma = ((await dialogo.getByTestId("link-firma-url").textContent()) ?? "").trim();
  expect(linkFirma).toMatch(/\/firma\/[A-Za-z0-9_-]{43}$/);
  await expect(dialogo.getByRole("link", { name: "Mandar por WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );
  await dialogo.getByRole("button", { name: "Listo" }).click();

  // El mail (transporte de prueba): a Trinidad, dice qué dueño lo firmó, link y PDF.
  await expect.poll(() => mails().length).toBe(antes + 1);
  const mail = mails().at(-1)!;
  expect(mail.to.map((t) => t.address)).toEqual([trinidad.email]);
  expect(mail.subject).toContain("firmado por Juan Cruz");
  expect(mail.text).toContain("FIRMADO POR JUAN CRUZ");
  expect(mail.text).toContain("Firmó y envió: Juan Cruz (dueño)");
  expect(mail.text).toContain(linkFirma);
  expect(mail.replyTo?.[0]?.address).toBe("juancruz@negocio.com");
  expect(mail.attachments?.[0]?.filename).toMatch(/^remito-VAP-R-/);

  // En el sistema: pagada, esperando la firma de Trinidad, con la firma del dueño.
  await expect(estado).toContainText("Pagada · esperando firma de Trinidad");
  const firmas = page.getByTestId("firmas-remito");
  await expect(firmas.getByRole("img", { name: /Firma del dueño: Juan Cruz/ })).toBeVisible();
  await expect(firmas).toContainText("Esperando la firma");
  await expect(page.getByTestId("envios-remito")).toContainText(`Para firmar → ${trinidad.email}`);
  await captura(page, "pagada-esperando-firma");

  const l = await db.liquidacionVendedor.findFirstOrThrow({
    where: { usuarioId: trinidad.id, mes: new Date(`${MES_ANTERIOR}-01T00:00:00Z`) },
  });
  expect(l.estado).toBe("PAGADA");
  const pdf = await esperarPdf(page.request, `/api/p/vapes/liquidaciones/${l.id}/remito`);
  if (!esMobile(page)) writeFileSync(`${CARPETA}/trinidad-remito-firmado-dueno.pdf`, pdf);
});

test("Trinidad abre el link sin sesión, firma y toca «Firmado»", async ({ page }) => {
  const ruta = new URL(linkFirma).pathname;
  await page.context().clearCookies();
  await page.goto(ruta);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hola, Trinidad");
  await expect(page.getByText("Juan Cruz te registró el pago")).toBeVisible();
  await expect(page.getByTestId("monto-remito")).toHaveText(formatearPesos(4500));
  await expect(page.getByRole("img", { name: /Firma del dueño: Juan Cruz/ })).toBeVisible();
  // El PDF del link, sin sesión.
  const token = ruta.split("/").at(-1)!;
  await esperarPdf(page.request, `/api/publico/remito/${token}`);
  await captura(page, "firma-link");

  const antes = mails().length;
  await firmarEnCanvas(page, page.getByTestId("firma-canvas"));
  await page.getByRole("button", { name: "Firmado" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Remito firmado");
  await expect(page.getByText(/^Firmado el /)).toBeVisible();
  await expect(page.getByRole("img", { name: /Firma de Trinidad: Trinidad/ })).toBeVisible();
  await captura(page, "firma-link-firmado");

  // El remito con las dos firmas, a la casilla de los dueños (MAIL_DUENOS).
  await expect.poll(() => mails().length).toBe(antes + 1);
  const mail = mails().at(-1)!;
  expect(mail.to.map((t) => t.address)).toEqual(["duenos-e2e@negocio.com"]);
  expect(mail.subject).toBe(`Trinidad firmó el remito de pago de ${nombreMes(MES_ANTERIOR)}`);
  expect(mail.text).toContain("Firma del dueño: Juan Cruz");

  // Un solo uso: el link ya no deja firmar, pero baja el remito final.
  await page.goto(ruta);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Remito firmado");
  await expect(page.getByTestId("firmar-remito")).toHaveCount(0);
  const pdf = await esperarPdf(page.request, `/api/publico/remito/${token}`);
  if (!esMobile(page)) writeFileSync(`${CARPETA}/trinidad-remito-firmado.pdf`, pdf);
  // Un token inventado no muestra nada.
  await page.goto(`/firma/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Este link no sirve");
});

test("el dueño ve la liquidación Firmada con las dos firmas y quién firmó", async ({ page }) => {
  await loginDueno(page);
  await page.goto(`/p/vapes/equipo/${trinidad.id}?mes=${MES_ANTERIOR}`);
  const estado = page.getByTestId("estado-liquidacion");
  await expect(estado).toContainText("Firmada");
  const firmas = page.getByTestId("firmas-remito");
  await expect(firmas.getByRole("img", { name: /Firma del dueño: Juan Cruz/ })).toBeVisible();
  await expect(firmas.getByRole("img", { name: /Firma de Trinidad: Trinidad/ })).toBeVisible();
  await expect(firmas).toContainText("por el link");
  await expect(page.getByTestId("envios-remito")).toContainText("Firmado → duenos-e2e@negocio.com");
  await expect(page.getByTestId("pdf-remito")).toHaveText(/Remito firmado \(PDF\)/);
  await expect(page.getByTestId("historial-liquidaciones")).toContainText("Firmada");
  await captura(page, "liquidacion-firmada");
  const l = await db.liquidacionVendedor.findFirstOrThrow({
    where: { usuarioId: trinidad.id, mes: new Date(`${MES_ANTERIOR}-01T00:00:00Z`) },
    include: { firmas: true, envios: true },
  });
  expect(l.estado).toBe("FIRMADA");
  expect(l.firmas.map((f) => f.rol).sort()).toEqual(["DUENO", "VENDEDOR"]);
  expect(l.envios.map((e) => [e.tipo, e.resultado]).sort()).toEqual([
    ["FIRMADO", "ENVIADO"],
    ["PARA_FIRMAR", "ENVIADO"],
  ]);
});

test("Trinidad logueada firma su remito desde el aviso del inicio", async ({ page }) => {
  test.skip(esMobile(page), "una vez alcanza (escritorio)");
  // Liquidación de hace dos meses ya pagada y firmada por el dueño (directo en la base).
  const dueno = await db.usuario.findFirstOrThrow({ where: { email: "juancruz@negocio.com" } });
  const firmaPng = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150"><path d="M20 120 C 80 10, 160 140, 380 30" stroke="#594A42" stroke-width="4" fill="none"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const categorias = ["MINORISTA", "MAYORISTA", "MINORISTA_NUEVO", "MAYORISTA_NUEVO"].map(
    (categoria, i) => ({
      categoria,
      ventas: i === 0 ? 2 : 0,
      unidades: i === 0 ? 4 : 0,
      unidadesDevueltas: 0,
      tarifa: ["1500.00", "300.00", "2000.00", "500.00"][i],
      monto: i === 0 ? "6000.00" : "0.00",
      totalVendido: i === 0 ? "40000.00" : "0.00",
    }),
  );
  await db.liquidacionVendedor.create({
    data: {
      panelId: PANEL_VAPES,
      usuarioId: trinidad.id,
      mes: new Date(`${MES_TRAS_ANTERIOR}-01T00:00:00Z`),
      estado: "PAGADA",
      tarifaMinorista: 1500,
      tarifaMayorista: 300,
      tarifaMinoristaNuevo: 2000,
      tarifaMayoristaNuevo: 500,
      total: 6000,
      cantidadVentas: 2,
      unidades: 4,
      totalVendido: 40000,
      categorias,
      detalle: [],
      montoPagado: 6000,
      medioPago: "EFECTIVO",
      fechaPago: new Date(),
      pagadaPorId: dueno.id,
      pagadaAt: new Date(),
      firmaTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      firmaTokenVenceAt: new Date(Date.now() + 86_400_000),
      firmas: {
        create: {
          panelId: PANEL_VAPES,
          rol: "DUENO",
          usuarioId: dueno.id,
          nombre: dueno.nombre,
          imagen: firmaPng,
        },
      },
    },
  });
  await login(page, trinidad.email, PASSWORD_TRINIDAD);
  await page.goto("/p/vapes");
  const aviso = page.getByTestId("aviso-remito-firmar");
  await expect(aviso).toContainText(`el pago de ${nombreMes(MES_TRAS_ANTERIOR)}`);
  await expect(aviso).toContainText("firmado por Juan Cruz");
  await aviso.click();
  await expect(page).toHaveURL(new RegExp(`/p/vapes/ganancia\\?mes=${MES_TRAS_ANTERIOR}`));
  const estado = page.getByTestId("estado-liquidacion");
  await expect(estado).toContainText("Pagada · esperando firma de Trinidad");
  await firmarEnCanvas(page, estado.getByTestId("firma-canvas"));
  await captura(page, "firma-desde-usuario");
  await estado.getByRole("button", { name: "Firmado" }).click();
  await expect(page.getByTestId("estado-liquidacion")).toContainText("Firmada");
  await expect(page.getByTestId("firmas-remito")).toContainText("desde su usuario");
  await page.goto("/p/vapes");
  await expect(page.getByTestId("aviso-remito-firmar")).toHaveCount(0);
});
