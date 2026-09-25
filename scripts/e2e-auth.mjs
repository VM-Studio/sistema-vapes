/**
 * E2E de auth, permisos y layout con Chrome headless (puppeteer-core usa el
 * Chrome instalado: no descarga navegadores).
 *
 * Requiere el build de producción corriendo contra una DB RECIÉN sembrada
 * (usa las contraseñas del seed y las cambia):
 *   pnpm build && pnpm start -p 3457      # con DATABASE_URL de una DB descartable
 *   pnpm test:e2e
 * Variables: E2E_BASE (default http://localhost:3457), CHROME_PATH.
 * Screenshots en verificacion/prompt2/ (ignorado por git).
 */
import fs from "node:fs";
import path from "node:path";

import puppeteer from "puppeteer-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3457";
const SHOTS = process.argv[2] ?? "verificacion/prompt2";
const MANIFEST = JSON.parse(
  fs.readFileSync(process.argv[3] ?? ".next/server/server-reference-manifest.json", "utf8"),
);
const PASS_SEED = "Cambiar123!";
fs.mkdirSync(SHOTS, { recursive: true });

let fallos = 0;
const check = (cond, msg) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
const actionId = (nombre) =>
  Object.entries(MANIFEST.node).find(([, v]) => v.exportedName === nombre)?.[0];

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check"],
});

async function nuevaSesion(viewport = DESKTOP) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  return { ctx, page };
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('button[type="submit"]'),
  ]);
  return new URL(page.url()).pathname;
}

async function cambiarPassword(page, actual, nueva) {
  await page.type('input[name="passwordActual"]', actual);
  await page.type('input[name="passwordNueva"]', nueva);
  await page.type('input[name="confirmacion"]', nueva);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("xpath/.//button[contains(., 'Cambiar contraseña')]"),
  ]);
  return new URL(page.url()).pathname;
}

/** Labels visibles de la navegación (sidebar en desktop, bottom bar + "Más" en mobile). */
async function navDesktop(page) {
  return page.$$eval("aside nav a", (as) => as.map((a) => a.textContent.trim()));
}

async function visible(page, selector) {
  return page.$eval(selector, (el) => {
    const s = getComputedStyle(el);
    return (
      s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().height > 0
    );
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, nombre) {
  const file = path.join(SHOTS, `${nombre}.png`);
  await esperar(300);
  const ancho = page.viewport().width;
  const { scroll, cortados } = await page.evaluate((w) => {
    // Controles que se salen de la pantalla y NO están dentro de un contenedor con scroll propio.
    const cortados = [...document.querySelectorAll("button, a, input, select, textarea")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.right <= w + 1) return false;
        for (let p = e.parentElement; p; p = p.parentElement) {
          if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return false;
        }
        return true;
      })
      .map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40));
    return { scroll: document.documentElement.scrollWidth, cortados };
  }, ancho);
  check(
    scroll <= ancho && cortados.length === 0,
    `[${nombre}] sin scroll horizontal ni controles cortados (${scroll}px en ${ancho}px${cortados.length ? `; cortados: ${cortados.join(", ")}` : ""})`,
  );
  await page.screenshot({ path: file });
  return file;
}

// ---------------------------------------------------------------------------
console.log("\n1) OWNER: login → /cuenta obligatorio → cambia password → ve todo");
const owner = await nuevaSesion(DESKTOP);
let destino = await login(owner.page, "dueno1@negocio.com", PASS_SEED);
check(destino === "/cuenta", `login con password del seed redirige a ${destino}`);
check(
  (await owner.page.content()).includes("Tenés que cambiar tu contraseña para continuar"),
  "aviso de cambio obligatorio visible",
);
await owner.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
check(
  new URL(owner.page.url()).pathname === "/cuenta",
  "intentar ir a /usuarios antes de cambiarla → vuelve a /cuenta",
);
await shot(owner.page, "01-desktop-cuenta-cambio-obligatorio");
destino = await cambiarPassword(owner.page, PASS_SEED, "DuenoUno2026");
check(destino === "/", `tras cambiarla entra al inicio (${destino})`);
const navOwner = await navDesktop(owner.page);
console.log(`     navegación: ${navOwner.join(" · ")}`);
check(
  [
    "Inicio",
    "Ventas",
    "Inventario",
    "Escanear",
    "Movimientos",
    "Compras",
    "Productos",
    "Clientes",
    "Proveedores",
    "Reportes",
    "Usuarios",
    "Configuración",
  ].every((l) => navOwner.includes(l)),
  `ve los ${navOwner.length} ítems (todos los módulos)`,
);
await shot(owner.page, "02-desktop-inicio-owner");

// ---------------------------------------------------------------------------
console.log(
  "\n2) EMPLEADO: solo Ventas/Inventario; /usuarios → /sin-acceso; Server Action → FORBIDDEN",
);
const emp = await nuevaSesion(MOBILE);
destino = await login(emp.page, "empleado@negocio.com", PASS_SEED);
check(destino === "/cuenta", `login redirige a ${destino}`);
destino = await cambiarPassword(emp.page, PASS_SEED, "Empleado2026");
check(destino === "/", `tras cambiarla entra al inicio (${destino})`);

const bottomEmp = await emp.page.$$eval('nav[aria-label="Navegación inferior"] li', (lis) =>
  lis.map((li) => li.textContent.trim()).filter(Boolean),
);
console.log(`     bottom bar (375px): ${bottomEmp.join(" · ")}`);
check(
  JSON.stringify(bottomEmp) ===
    JSON.stringify(["Inicio", "Ventas", "Escanear", "Inventario", "Más"]),
  "bottom bar: Inicio, Ventas, Escanear (botón central, deriva de Inventario), Inventario, Más",
);
await emp.page.click('nav[aria-label="Navegación inferior"] button');
await emp.page.waitForSelector("dialog[open]");
const masEmp = await emp.page.$$eval("dialog[open] ul a", (as) =>
  as.map((a) => a.textContent.trim()),
);
check(
  JSON.stringify(masEmp) === JSON.stringify([]),
  `sheet "Más": sin otros módulos, solo cuenta y salir: [${masEmp.join(", ")}]`,
);
await shot(emp.page, "03-mobile-empleado-mas-abierto");
await emp.page.keyboard.press("Escape");
await shot(emp.page, "04-mobile-inicio-empleado");

await emp.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
check(
  new URL(emp.page.url()).pathname === "/sin-acceso",
  `/usuarios a mano → ${new URL(emp.page.url()).pathname}`,
);
check(
  (await emp.page.content()).includes("Pedile a un dueño que te lo habilite"),
  "mensaje de /sin-acceso",
);
await shot(emp.page, "05-mobile-sin-acceso");
await emp.page.goto(`${BASE}/reportes`, { waitUntil: "networkidle0" });
check(new URL(emp.page.url()).pathname === "/sin-acceso", "/reportes (sin permiso) → /sin-acceso");

const idCrear = actionId("crearUsuarioAction");
const respAccion = await emp.page.evaluate(async (id) => {
  const r = await fetch("/usuarios", {
    method: "POST",
    headers: {
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
    body: JSON.stringify([
      { nombre: "Intruso", email: "intruso@x.com", rol: "OWNER", password: "clave1234" },
    ]),
  });
  return { status: r.status, body: await r.text() };
}, idCrear);
const resultadoAccion = respAccion.body.split("\n").find((l) => l.includes('"ok"'));
console.log(
  `     crearUsuarioAction como empleado → HTTP ${respAccion.status}: ${resultadoAccion?.replace(/^\d+:/, "")}`,
);
check(
  /"ok":false/.test(respAccion.body) && /"code":"FORBIDDEN"/.test(respAccion.body),
  "la Server Action devuelve { ok:false, error:{ code:'FORBIDDEN' } }",
);

// ---------------------------------------------------------------------------
console.log(
  "\n3) OWNER habilita REPORTES al empleado → aparece en su siguiente request, sin re-login",
);
await owner.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
await shot(owner.page, "06-desktop-usuarios-tabla");
const hrefPermisos = await owner.page.$eval('a[href$="/permisos"]', (a) => a.getAttribute("href"));
await owner.page.goto(`${BASE}${hrefPermisos}`, { waitUntil: "networkidle0" });
await owner.page.click(
  "xpath/.//label[.//span[normalize-space()='Ver Reportes']]//button[@role='switch']",
);
await shot(owner.page, "07-desktop-permisos-grilla");
await owner.page.click("xpath/.//button[contains(., 'Guardar cambios')]");
await owner.page.waitForFunction(() => document.body.innerText.includes("Permisos guardados"));
check(true, "owner guardó: Reportes → Ver");

await emp.page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await emp.page.click('nav[aria-label="Navegación inferior"] button');
await emp.page.waitForSelector("dialog[open]");
const masEmp2 = await emp.page.$$eval("dialog[open] ul a", (as) =>
  as.map((a) => a.textContent.trim()),
);
check(
  masEmp2.includes("Reportes"),
  `siguiente request del empleado: "Más" ahora trae [${masEmp2.join(", ")}]`,
);
await shot(emp.page, "08-mobile-empleado-reportes-habilitado");
await emp.page.goto(`${BASE}/reportes`, { waitUntil: "networkidle0" });
check(
  new URL(emp.page.url()).pathname === "/reportes",
  "y /reportes ya abre (misma sesión, sin re-login)",
);

// ---------------------------------------------------------------------------
console.log("\n4) Rate limit: 6 intentos fallidos seguidos para el mismo email");
for (let i = 1; i <= 7; i++) {
  const password = i === 7 ? PASS_SEED : "incorrecta";
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: "dueno2@negocio.com", password }),
  });
  const j = await r.json();
  const esperado = i <= 5 ? 401 : 429;
  const nota = i === 7 ? " (¡con la contraseña CORRECTA!)" : "";
  check(
    r.status === esperado,
    `intento ${i}${nota}: HTTP ${r.status} ${j.error?.message}${r.headers.get("retry-after") ? ` · Retry-After ${r.headers.get("retry-after")}s` : ""}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n6) Layout 375px vs 1440px");
check(
  await visible(emp.page, 'nav[aria-label="Navegación inferior"].fixed'),
  "375px: bottom navigation visible",
);
check(!(await visible(emp.page, "aside")), "375px: sidebar oculto");
check(await visible(emp.page, "header.fixed"), "375px: barra superior fija visible");
const altoItem = await emp.page.$eval(
  'nav[aria-label="Navegación inferior"] a',
  (a) => a.getBoundingClientRect().height,
);
check(altoItem >= 44, `375px: ítems de la bottom bar de ${Math.round(altoItem)}px de alto (≥44)`);
const fuenteInput = await (async () => {
  await emp.page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle0" });
  return emp.page.$eval('input[name="passwordActual"]', (i) =>
    parseFloat(getComputedStyle(i).fontSize),
  );
})();
check(fuenteInput >= 16, `375px: inputs con font-size ${fuenteInput}px (≥16, sin zoom en iOS)`);
await shot(emp.page, "09-mobile-cuenta");
check(await visible(owner.page, "aside"), "1440px: sidebar visible");
check(
  !(await visible(owner.page, 'nav[aria-label="Navegación inferior"].fixed')),
  "1440px: bottom navigation oculta",
);

const ownerMobile = await nuevaSesion(MOBILE);
await login(ownerMobile.page, "dueno1@negocio.com", "DuenoUno2026");
await shot(ownerMobile.page, "10-mobile-inicio-owner");
await ownerMobile.page.click('nav[aria-label="Navegación inferior"] button');
await ownerMobile.page.waitForSelector("dialog[open]");
await shot(ownerMobile.page, "11-mobile-owner-mas-abierto");
await ownerMobile.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
await shot(ownerMobile.page, "12-mobile-usuarios-cards");
await ownerMobile.page.goto(`${BASE}${hrefPermisos}`, { waitUntil: "networkidle0" });
await shot(ownerMobile.page, "13-mobile-permisos-cards");
await ownerMobile.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
await ownerMobile.page.click("xpath/.//button[contains(., 'Nuevo usuario')]");
await ownerMobile.page.waitForSelector("dialog[open]");
await shot(ownerMobile.page, "14-mobile-sheet-nuevo-usuario");

await owner.page.click('button[aria-label="Colapsar menú"]');
await shot(owner.page, "15-desktop-sidebar-colapsado");
await owner.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await owner.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
await shot(owner.page, "16-desktop-usuarios-dark");
await ownerMobile.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await ownerMobile.page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await shot(ownerMobile.page, "17-mobile-inicio-owner-dark");
await owner.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await owner.page.click('button[aria-label="Expandir menú"]');

// ---------------------------------------------------------------------------
console.log("\nExtra) Desactivar al empleado corta su sesión en el siguiente request");
const idEmpleado = hrefPermisos.split("/")[2];
const respBaja = await owner.page.evaluate(
  async (id, empleadoId) => {
    const r = await fetch("/usuarios", {
      method: "POST",
      headers: {
        "Next-Action": id,
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
      },
      body: JSON.stringify([
        {
          id: empleadoId,
          nombre: "Empleado",
          email: "empleado@negocio.com",
          rol: "EMPLEADO",
          activo: false,
        },
      ]),
    });
    return r.text();
  },
  actionId("actualizarUsuarioAction"),
  idEmpleado,
);
check(/"ok":true/.test(respBaja), "owner desactiva al empleado (actualizarUsuarioAction → ok)");
await emp.page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
check(
  new URL(emp.page.url()).pathname === "/login",
  `siguiente request del empleado → ${new URL(emp.page.url()).pathname} (cookie invalidada)`,
);

console.log("\nLogout");
await Promise.all([
  owner.page.waitForNavigation({ waitUntil: "networkidle0" }),
  owner.page.click("aside form button[type=submit]"),
]);
check(new URL(owner.page.url()).pathname === "/login", "cerrar sesión → /login");
await owner.page.goto(`${BASE}/usuarios`, { waitUntil: "networkidle0" });
check(new URL(owner.page.url()).pathname === "/login", "después del logout, /usuarios → /login");

await browser.close();
console.log(fallos === 0 ? "\nE2E OK ✅" : `\n${fallos} verificación(es) fallaron ❌`);
process.exit(fallos === 0 ? 0 : 1);
