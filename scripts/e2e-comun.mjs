/**
 * Helpers compartidos por los E2E (Chrome headless con puppeteer-core).
 * Cada suite importa lo que usa: navegador, sesión, login, capturas con
 * control de desborde, clicks "como persona" (espera a que nada tape el
 * botón), pistola simulada (teclas reales cada 10 ms + Enter) y SQL.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import puppeteer from "puppeteer-core";

export const BASE = process.env.E2E_BASE ?? "http://localhost:3457";
export const DB = process.env.E2E_DB ?? "gestion_verif";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const MOBILE = {
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
export const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearVerificador(shotsDir) {
  fs.mkdirSync(shotsDir, { recursive: true });
  const estado = { fallos: 0, paginas: [] };
  const check = (cond, msg) => {
    if (!cond) estado.fallos++;
    console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
  };

  async function sesion(browser, viewport) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    estado.paginas.push(page);
    page.on("pageerror", (e) => {
      estado.fallos++;
      console.log(`  ✘ error en la página: ${e.message}`);
    });
    return page;
  }

  async function shot(page, nombre) {
    await esperar(350);
    const ancho = page.viewport().width;
    const { scroll, cortados } = await page.evaluate((w) => {
      const cortados = [...document.querySelectorAll("button, a, input, select, textarea")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.right <= w + 1) return false;
          for (let p = e.parentElement; p; p = p.parentElement) {
            if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return false;
          }
          return true;
        })
        .map((e) =>
          (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40),
        );
      return { scroll: document.documentElement.scrollWidth, cortados };
    }, ancho);
    check(
      scroll <= ancho && cortados.length === 0,
      `[${nombre}] sin scroll horizontal ni controles cortados (${scroll}px en ${ancho}px${cortados.length ? `; cortados: ${cortados.join(", ")}` : ""})`,
    );
    await page.screenshot({ path: path.join(shotsDir, `${nombre}.png`) });
  }

  /** Captura + estado de la última página ante cualquier error inesperado. */
  async function diagnosticar(e) {
    console.log(`  ✘ ERROR: ${e?.message ?? e}`);
    const page = estado.paginas.at(-1);
    if (page) {
      await page.screenshot({ path: path.join(shotsDir, "zz-fallo.png") }).catch(() => {});
      const info = await page
        .evaluate(() => ({
          url: location.href,
          dialogs: document.querySelectorAll("dialog[open]").length,
          toasts: [...document.querySelectorAll('[role="status"],[role="alert"]')].map((t) =>
            t.textContent.trim(),
          ),
        }))
        .catch(() => null);
      console.log(`     estado: ${JSON.stringify(info)}`);
    }
    process.exit(1);
  }
  process.on("uncaughtException", diagnosticar);
  process.on("unhandledRejection", diagnosticar);

  return { check, sesion, shot, estado };
}

export function lanzar(args = []) {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args });
}

export function sql(q) {
  return execFileSync("docker", [
    "exec",
    "sistema_vapes_db",
    "psql",
    "-U",
    "app",
    "-d",
    DB,
    "-Atc",
    q,
  ])
    .toString()
    .trim();
}

/** Login: con la contraseña del seed (y la cambia) o, si ya se cambió, con la nueva. */
export async function login(page, email, nueva) {
  for (const password of ["Cambiar123!", nueva]) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    const entro = await page
      .waitForFunction(() => location.pathname !== "/login", { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (entro) break;
  }
  await page.waitForNetworkIdle();
  if (new URL(page.url()).pathname === "/cuenta") {
    await page.type('input[name="passwordActual"]', "Cambiar123!");
    await page.type('input[name="passwordNueva"]', nueva);
    await page.type('input[name="confirmacion"]', nueva);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.click("xpath/.//button[contains(., 'Cambiar contraseña')]"),
    ]);
  }
}

export const ir = (page, ruta) => page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle0" });

/** Toca como una persona: si algo lo tapa (un toast), espera a que se destape (hasta 8 s). */
export async function tocar(page, el, descripcion) {
  // Centrado: en el celular hay barras fijas abajo (total, navegación) que tapan lo que queda al borde.
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const libre = () =>
    el.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return arriba !== null && (arriba === e || e.contains(arriba));
    });
  const t0 = Date.now();
  while (!(await libre())) {
    if (Date.now() - t0 > 8000) throw new Error(`«${descripcion}» sigue tapado por otro elemento`);
    await esperar(200);
  }
  await el.click();
}

export async function clickTexto(page, tag, texto) {
  for (const el of await page.$$(`xpath/.//${tag}[contains(normalize-space(.), '${texto}')]`)) {
    if (await el.isVisible()) return tocar(page, el, texto);
  }
  throw new Error(`No hay ${tag} visible con el texto "${texto}"`);
}

export async function clickSelector(page, selector) {
  const el = await page.waitForSelector(selector, { visible: true });
  return tocar(page, el, selector);
}

export async function esperarTexto(page, texto, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, texto);
}

/** Escribe a ritmo humano (60 ms: no es una pistola) reemplazando lo que haya. */
export async function escribir(page, selector, texto) {
  await page.$eval(selector, (e) => {
    e.focus();
    e.select?.();
  });
  await page.keyboard.press("Backspace");
  await page.type(selector, texto, { delay: 60 });
}

/** <select> por selector CSS, eligiendo la opción por su texto. */
export async function elegirEn(page, selector, textoOpcion) {
  const value = await page.$eval(
    selector,
    (s, t) => [...s.options].find((o) => o.textContent.includes(t))?.value,
    textoOpcion,
  );
  await page.select(selector, value);
}

/** Pistola: teclas reales cada 10 ms + Enter, sin tocar nada antes (450 ms entre repeticiones). */
export async function pistola(page, codigo, veces = 1) {
  for (let i = 0; i < veces; i++) {
    await page.keyboard.type(codigo, { delay: 10 });
    await page.keyboard.press("Enter");
    await esperar(450);
  }
}

/** Invoca una Server Action directo (como lo haría un atacante con la sesión del usuario). */
export async function accion(page, nombre, args) {
  const manifest = JSON.parse(
    fs.readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  );
  const id = Object.entries(manifest.node).find(([, v]) => v.exportedName === nombre)?.[0];
  if (!id) throw new Error(`No encontré la Server Action ${nombre}`);
  return page.evaluate(
    async (actionId, a) => {
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
    id,
    args,
  );
}
