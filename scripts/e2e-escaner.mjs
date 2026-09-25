/**
 * E2E del Prompt 4 (escáner pistola + cámara, hub /escanear, compras,
 * proveedores y etiquetas) por la UI real, con Chrome headless.
 *
 * - Pistola: teclas REALES (CDP) cada 10 ms + Enter, sin foco en ningún input.
 * - Cámara: la cámara falsa de Chrome reproduce un video .y4m armado con
 *   ffmpeg a partir de un EAN-13 (bwip-js) y de una etiqueta del PDF
 *   rasterizada con qlmanage (PDFKit de macOS).
 *
 * Requiere el build de producción corriendo contra una DB RECIÉN sembrada:
 *   pnpm build && pnpm start -p 3457     # con DATABASE_URL de una DB descartable
 *   E2E_DB=gestion_verif pnpm test:e2e:escaner
 * Screenshots en verificacion/prompt4/ (ignorado por git).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import bwipjs from "bwip-js/node";
import puppeteer from "puppeteer-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3457";
const DB = process.env.E2E_DB ?? "gestion_verif";
const SHOTS = path.resolve(process.argv[2] ?? "verificacion/prompt4");
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(SHOTS, { recursive: true });

let fallos = 0;
const check = (cond, msg) => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "✔" : "✘"} ${msg}`);
};
const sql = (q) =>
  execFileSync("docker", ["exec", "sistema_vapes_db", "psql", "-U", "app", "-d", DB, "-Atc", q])
    .toString()
    .trim();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function ean13(base12) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (s % 10)) % 10}`;
}

const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };

// -----------------------------------------------------------------------------
// Navegador y helpers
// -----------------------------------------------------------------------------

async function lanzar(video, { aceptarPermiso = true } = {}) {
  const args = video
    ? [
        "--use-fake-device-for-media-stream",
        ...(aceptarPermiso ? ["--use-fake-ui-for-media-stream"] : []),
        `--use-file-for-fake-video-capture=${video}`,
      ]
    : [];
  return puppeteer.launch({ executablePath: CHROME, headless: true, args });
}

async function sesion(browser, viewport, { sinDetectorNativo = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  // Registra los streams de cámara para verificar que se liberan.
  await page.evaluateOnNewDocument((sinNativo) => {
    if (sinNativo) delete window.BarcodeDetector;
    window.__streams = [];
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => {
        const s = await original(c);
        window.__streams.push(s);
        return s;
      };
    }
  }, sinDetectorNativo);
  abiertas.push(page);
  page.on("pageerror", (e) => {
    fallos++;
    console.log(`  ✘ error en la página: ${e.message}`);
  });
  return page;
}

/** Login: con la contraseña del seed (y la cambia) o, si ya se cambió, con la nueva. */
async function login(page, email, nueva) {
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

const ir = (page, ruta) => page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle0" });

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
      .map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 40));
    return { scroll: document.documentElement.scrollWidth, cortados };
  }, ancho);
  check(
    scroll <= ancho && cortados.length === 0,
    `[${nombre}] sin scroll horizontal ni controles cortados (${scroll}px en ${ancho}px${cortados.length ? `; cortados: ${cortados.join(", ")}` : ""})`,
  );
  await page.screenshot({ path: path.join(SHOTS, `${nombre}.png`) });
}

/**
 * Toca el elemento como una persona: si algo lo tapa (un toast), espera a que
 * se destape (hasta 8 s); si sigue tapado, es un error de diseño y falla.
 */
async function tocar(page, el, descripcion) {
  await el.scrollIntoView();
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

async function clickTexto(page, tag, texto) {
  for (const el of await page.$$(`xpath/.//${tag}[contains(normalize-space(.), '${texto}')]`)) {
    if (await el.isVisible()) return tocar(page, el, texto);
  }
  throw new Error(`No hay ${tag} visible con el texto "${texto}"`);
}

/** Botón cuyo texto es exactamente `texto` ("Guardar" ≠ "Guardar y cargar stock"). */
async function clickExacto(page, texto) {
  for (const el of await page.$$(`xpath/.//button[normalize-space(.)='${texto}']`)) {
    if (await el.isVisible()) return tocar(page, el, texto);
  }
  throw new Error(`No hay botón visible «${texto}»`);
}

/** <select> por selector CSS, eligiendo la opción por su texto. */
async function elegirEn(page, selector, textoOpcion) {
  const value = await page.$eval(
    selector,
    (s, t) => [...s.options].find((o) => o.textContent.includes(t))?.value,
    textoOpcion,
  );
  await page.select(selector, value);
}

async function esperarTexto(page, texto, timeout = 15000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, texto);
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, "zz-fallo.png") });
    console.log(`  ✘ no apareció «${texto}» (captura en zz-fallo.png)`);
    throw e;
  }
}

/** Elige una opción de un <select> por el texto de su <label> y el de la opción. */
async function elegir(page, label, textoOpcion) {
  const { id, value } = await page.evaluate(
    (l, t) => {
      const lab = [...document.querySelectorAll("label")].find(
        (x) => x.textContent.trim().startsWith(l) && x.control?.tagName === "SELECT",
      );
      const opt = [...lab.control.options].find((o) => o.textContent.includes(t));
      return { id: lab.control.id, value: opt.value };
    },
    label,
    textoOpcion,
  );
  await page.select(`[id="${id}"]`, value);
}

async function escribir(page, selector, texto) {
  await page.$eval(selector, (e) => {
    e.focus();
    e.select();
  });
  await page.keyboard.press("Backspace");
  await page.type(selector, texto, { delay: 60 }); // ritmo humano (no es una pistola)
}

/**
 * La pistola: teclas reales cada 10 ms y Enter, SIN tocar nada antes (el foco
 * queda donde esté). Entre repeticiones 450 ms (el mismo código en < 300 ms
 * se toma como doble disparo).
 */
async function pistola(page, codigo, veces = 1) {
  for (let i = 0; i < veces; i++) {
    await page.keyboard.type(codigo, { delay: 10 });
    await page.keyboard.press("Enter");
    await esperar(450);
  }
}

const dialogoAbierto = (page) => page.waitForSelector("dialog[open]", { visible: true });

const [G1, G2] = sql(
  `SELECT id FROM "Deposito" WHERE activo ORDER BY "esPrincipal" DESC, nombre`,
).split("\n");
const varianteId = (producto, variante) =>
  sql(
    `SELECT v.id FROM "Variante" v JOIN "Producto" p ON p.id = v."productoId" WHERE p.nombre = '${producto}' AND v.nombre = '${variante}'`,
  );
const stock = (vid, dep) =>
  Number(
    sql(
      `SELECT coalesce((SELECT cantidad FROM "Stock" WHERE "varianteId" = '${vid}' AND "depositoId" = '${dep}'), 0)`,
    ),
  );
const codigoDe = (vid) => sql(`SELECT "codigoBarras" FROM "Variante" WHERE id = '${vid}'`);

const sufijo = String(Date.now()).slice(-5);
const MANGO = varianteId("Ignite V80", "Mango Ice");
const COOL_MINT = varianteId("Elf Bar BC5000", "Cool Mint");
const BLUE_RAZZ = varianteId("Ignite V80", "Blue Razz Ice");
const WATERMELON = varianteId("Elf Bar BC5000", "Watermelon Ice");
const COD_MANGO = codigoDe(MANGO);

const browser = await lanzar(null);
const abiertas = [];
// Ante cualquier error no previsto: captura y estado de la última página usada.
async function diagnosticar(e) {
  console.log(`  ✘ ERROR: ${e?.message ?? e}`);
  const page = abiertas.at(-1);
  if (page) {
    await page.screenshot({ path: path.join(SHOTS, "zz-fallo.png") }).catch(() => {});
    const estado = await page
      .evaluate(() => ({
        url: location.href,
        dialogs: document.querySelectorAll("dialog[open]").length,
        foco: `${document.activeElement?.tagName}#${document.activeElement?.id}`,
        toasts: [...document.querySelectorAll('[role="status"],[role="alert"]')].map((t) =>
          t.textContent.trim(),
        ),
      }))
      .catch(() => null);
    console.log(`     estado: ${JSON.stringify(estado)}`);
  }
  process.exit(1);
}
process.on("uncaughtException", diagnosticar);
process.on("unhandledRejection", diagnosticar);

// =============================================================================
console.log("\n0) Preparación: se agrega el sabor «Frutilla» a Ignite V80 desde el formulario");
const owner = await sesion(browser, MOBILE);
await login(owner, "dueno1@negocio.com", "DuenoUno2026");
const igniteId = sql(`SELECT id FROM "Producto" WHERE nombre = 'Ignite V80'`);
const COD_FRUTILLA = ean13(`7793${sufijo}001`);
await ir(owner, `/productos/${igniteId}/editar`);
const filas = await owner.$$eval('input[id$="-nombre"][id^="variantes-"]', (l) => l.length);
await owner.click('button[aria-label="Duplicar variante 1"]');
await owner.waitForSelector(`#variantes-${filas}-nombre`);
await owner.type(`#variantes-${filas}-nombre`, "Frutilla", { delay: 30 });
await owner.type(`#variantes-${filas}-codigoBarras`, COD_FRUTILLA, { delay: 30 });
await esperar(600); // verificación en vivo del código
await clickExacto(owner, "Guardar");
await owner
  .waitForFunction((id) => location.pathname === `/productos/${id}`, { timeout: 15000 }, igniteId)
  .catch(async (e) => {
    await owner.screenshot({ path: path.join(SHOTS, "zz-fallo.png"), fullPage: true });
    const errores = await owner.$$eval('[id$="-error"], [role="alert"], [role="status"]', (l) =>
      l.map((x) => x.textContent.trim()).filter(Boolean),
    );
    console.log(`  ✘ no guardó: ${JSON.stringify(errores)}`);
    throw e;
  });
const FRUTILLA = varianteId("Ignite V80", "Frutilla");
check(
  Boolean(FRUTILLA) && codigoDe(FRUTILLA) === COD_FRUTILLA,
  `Ignite V80 — Frutilla creada con EAN-13 ${COD_FRUTILLA}`,
);

// =============================================================================
console.log("\n1) Navegación: /escanear es el botón central elevado de la bottom bar");
await ir(owner, "/");
const bottom = await owner.$$eval('nav[aria-label="Navegación inferior"] li', (l) =>
  l.map((x) => x.textContent.trim()),
);
check(
  bottom.join() === "Inicio,Ventas,Escanear,Inventario,Más",
  `bottom bar: ${bottom.join(" · ")}`,
);
const boton = await owner.$eval(
  'nav[aria-label="Navegación inferior"] a[href="/escanear"] span',
  (e) => {
    const r = e.getBoundingClientRect();
    const nav = e.closest("nav").getBoundingClientRect();
    return {
      alto: r.height,
      sobresale: nav.top - r.top,
      redondo: getComputedStyle(e).borderRadius,
    };
  },
);
check(
  boton.alto >= 56 && boton.sobresale > 0,
  `botón Escanear de ${boton.alto}px, sobresale ${Math.round(boton.sobresale)}px de la barra`,
);
await clickTexto(owner, "button", "Más");
await dialogoAbierto(owner);
const mas = await owner.$$eval("dialog[open] ul a", (as) => as.map((a) => a.textContent.trim()));
check(
  mas.includes("Compras") && mas.includes("Proveedores") && mas.includes("Productos"),
  `«Más» incluye Compras, Proveedores y Productos: [${mas.join(", ")}]`,
);
await owner.keyboard.press("Escape");

// =============================================================================
console.log("\n2) /escanear Ingresar: pistola 3× Mango Ice + 2× Frutilla en Galpón 2");
await ir(owner, "/escanear");
await shot(owner, "01-mobile-escanear-consultar-vacio");
await clickTexto(owner, "button", "Ingresar");
await owner.waitForFunction(() => location.search.includes("modo=ingresar"));
await elegir(owner, "Depósito", "Galpón 2");
await owner.evaluate(() => document.activeElement?.blur());
const antesMango = stock(MANGO, G2);
const antesFrutilla = stock(FRUTILLA, G2);
const t0 = sql(`SELECT max("createdAt") FROM "MovimientoStock"`);
await pistola(owner, COD_MANGO, 3);
await pistola(owner, COD_FRUTILLA, 2);
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos escaneados"] > li').length === 2,
  { timeout: 10000 },
);
const cantidades = await owner.$$eval(
  'ul[aria-label="Productos escaneados"] input[aria-label^="Cantidad de"]',
  (l) => l.map((i) => `${i.getAttribute("aria-label").replace("Cantidad de ", "")}=${i.value}`),
);
check(
  cantidades.sort().join() === "Ignite V80 — Frutilla=2,Ignite V80 — Mango Ice=3",
  `carrito (último escaneado arriba): ${cantidades.join(", ")}`,
);
check(
  new URL(owner.url()).searchParams.get("deposito") === G2,
  "el depósito activo queda en la URL (?deposito=)",
);
check(
  (await owner.evaluate(() => localStorage.getItem("escanear.deposito"))) === JSON.stringify(G2),
  "…y en localStorage",
);
await shot(owner, "02-mobile-escanear-ingresar-carrito");

// Sesión persistida: recargar ofrece retomar.
await owner.reload({ waitUntil: "networkidle0" });
await esperarTexto(owner, "Retomar sesión");
await shot(owner, "03-mobile-escanear-retomar-sesion");
await clickTexto(owner, "button", "Retomar sesión");
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos escaneados"] > li').length === 2,
);
check(true, "al recargar: «Tenés una sesión…» → Retomar recupera los 2 productos");

await clickTexto(owner, "button", "Confirmar ingreso (5 u.)");
await dialogoAbierto(owner);
await owner.type("dialog[open] input", "Mercadería sin factura (E2E)", { delay: 20 });
await shot(owner, "04-mobile-escanear-confirmar-dialogo");
await clickTexto(owner, "dialog[@open]//button", "Confirmar ingreso");
await esperarTexto(owner, "Ingresaron 5 unidades");
const ledger = sql(
  `SELECT v.nombre || ':' || m.cantidad FROM "MovimientoStock" m JOIN "Variante" v ON v.id = m."varianteId" WHERE m.tipo = 'INGRESO_MANUAL' AND m."depositoId" = '${G2}' AND m."createdAt" > '${t0}' ORDER BY v.nombre`,
).split("\n");
check(
  ledger.join() === "Frutilla:2,Mango Ice:3",
  `ledger: 2 INGRESO_MANUAL (${ledger.join(", ")})`,
);
check(
  stock(MANGO, G2) === antesMango + 3 && stock(FRUTILLA, G2) === antesFrutilla + 2,
  `inventario Galpón 2: Mango ${antesMango} → ${stock(MANGO, G2)} (+3), Frutilla ${antesFrutilla} → ${stock(FRUTILLA, G2)} (+2)`,
);
check(
  (await owner.evaluate(() => localStorage.getItem("escanear.sesion"))) === null,
  "confirmado → la sesión guardada se borra",
);

// =============================================================================
console.log("\n3) Código desconocido → asociar a un producto → al re-escanear se reconoce");
const DESCONOCIDO = ean13(`7792${sufijo}002`);
await clickTexto(owner, "button", "Consultar");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, DESCONOCIDO);
await esperarTexto(owner, "Este código no existe");
await shot(owner, "05-mobile-codigo-desconocido-sheet");
await owner.type(
  "dialog[open] input[type=search], dialog[open] input[role=combobox]",
  "Cool Mint",
  { delay: 30 },
);
await owner.waitForSelector("dialog[open] [role=option]", { visible: true });
await owner.click("dialog[open] [role=option]");
await clickTexto(owner, "dialog[@open]//button", "Asociar");
await owner.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 10000 });
check(
  sql(
    `SELECT count(*) FROM "CodigoBarrasAlternativo" WHERE codigo = '${DESCONOCIDO}' AND "varianteId" = '${COOL_MINT}'`,
  ) === "1",
  `${DESCONOCIDO} guardado como código alternativo de Elf Bar BC5000 — Cool Mint`,
);
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, DESCONOCIDO);
await owner.waitForSelector('section[aria-label="Producto"]');
const ficha = await owner.$eval('section[aria-label="Producto"]', (s) =>
  s.innerText.replace(/\s+/g, " "),
);
check(
  ficha.includes("Elf Bar BC5000 — Cool Mint") && ficha.includes("leído por código alternativo"),
  `re-escaneo → ficha: «${ficha.slice(0, 90)}…»`,
);
await shot(owner, "06-mobile-escanear-consultar-ficha");

// Crear producto con el código precargado y volver al hub.
const NUEVO_COD = ean13(`7791${sufijo}003`);
await clickTexto(owner, "button", "Ingresar");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, NUEVO_COD);
await esperarTexto(owner, "Este código no existe");
await clickTexto(owner, "dialog[@open]//a", "Crear producto con este código");
await owner.waitForSelector("#variantes-0-codigoBarras", { timeout: 15000 });
const urlNuevo = new URL(owner.url());
check(
  urlNuevo.pathname === "/productos/nuevo" &&
    (await owner.$eval("#variantes-0-codigoBarras", (e) => e.value)) === NUEVO_COD,
  `«Crear producto» abre /productos/nuevo con el código ${NUEVO_COD} precargado`,
);
await owner.type('input[name="nombre"]', `Pod E2E ${sufijo}`, { delay: 20 });
await elegirEn(owner, 'select[name="categoriaId"]', "Vapes");
await owner.type("#variantes-0-nombre", "Uva", { delay: 20 });
await owner.type("#variantes-0-precioCosto", "3000", { delay: 20 });
await owner.type("#variantes-0-precioVenta", "6000", { delay: 20 });
await esperar(600);
await clickExacto(owner, "Guardar");
await owner
  .waitForFunction(() => location.pathname === "/escanear", { timeout: 15000 })
  .catch(async (e) => {
    await owner.screenshot({ path: path.join(SHOTS, "zz-fallo.png"), fullPage: true });
    const errores = await owner.$$eval(
      '.text-danger, [aria-invalid="true"], [role="alert"], [role="status"]',
      (l) =>
        l.map(
          (x) =>
            `${x.tagName}#${x.id || x.getAttribute("name")}:${x.textContent.trim() || x.value}`,
        ),
    );
    const invalidos = await owner.$$eval("input, select, textarea", (l) =>
      l
        .filter((e) => !e.checkValidity())
        .map((e) => `${e.name || e.id}=«${e.value}» ${e.validationMessage}`),
    );
    const foco = await owner.evaluate(
      () => `${document.activeElement?.tagName}#${document.activeElement?.id}`,
    );
    console.log(`     inválidos (HTML): ${JSON.stringify(invalidos)} · foco: ${foco}`);
    console.log(`  ✘ no volvió a /escanear (${owner.url()}): ${JSON.stringify(errores)}`);
    throw e;
  });
await owner.waitForFunction(
  (n) =>
    [...document.querySelectorAll('ul[aria-label="Productos escaneados"] li')].some((l) =>
      l.innerText.includes(n),
    ),
  { timeout: 10000 },
  `Pod E2E ${sufijo}`,
);
check(true, "al guardar vuelve a /escanear y el producto nuevo queda en el carrito");
for (const b of await owner.$$(
  'ul[aria-label="Productos escaneados"] button[aria-label^="Quitar"]',
))
  await b.click();

// =============================================================================
console.log("\n5) Contar: sistema 50, escaneados 48 → AJUSTE_NEGATIVO de 2");
// Blue Razz Ice en Galpón 1 → 50 (ajuste simple con motivo, como haría el encargado).
await ir(owner, `/movimientos/ajuste?variante=${BLUE_RAZZ}&deposito=${G1}`);
await escribir(owner, 'input[inputmode="numeric"]', "50");
await owner.type("textarea", "Preparación del recuento (E2E)", { delay: 10 });
await clickTexto(owner, "button", "Revisar ajuste");
await dialogoAbierto(owner);
await clickTexto(owner, "dialog[@open]//button", "Aplicar ajuste");
await esperarTexto(owner, "Stock ajustado");
check(stock(BLUE_RAZZ, G1) === 50, "Ignite V80 — Blue Razz Ice en Galpón 1: 50 en el sistema");
await ir(owner, `/escanear?modo=contar&deposito=${G1}`);
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, codigoDe(BLUE_RAZZ), 48);
await owner.waitForFunction(
  () =>
    document.querySelector('ul[aria-label="Productos escaneados"] input[aria-label^="Cantidad de"]')
      ?.value === "48",
  { timeout: 15000 },
);
const filaContar = await owner.$eval('ul[aria-label="Productos escaneados"] > li', (l) =>
  l.innerText.replace(/\s+/g, " "),
);
check(/50/.test(filaContar) && /-2|−2/.test(filaContar), `fila del recuento: «${filaContar}»`);
const colorDif = await owner
  .$eval(
    'ul[aria-label="Productos escaneados"] > li .text-danger',
    (e) => getComputedStyle(e).color,
  )
  .catch(() => null);
check(Boolean(colorDif), `la diferencia negativa se muestra en rojo (${colorDif})`);
await shot(owner, "07-mobile-escanear-contar");
await clickTexto(owner, "button", "Aplicar recuento (1)");
await dialogoAbierto(owner);
await owner.type("dialog[open] input", "Recuento con escáner", { delay: 10 });
await shot(owner, "08-mobile-escanear-contar-confirmar");
await clickTexto(owner, "dialog[@open]//button", "Aplicar");
await esperarTexto(owner, "Recuento aplicado");
const ajuste = sql(
  `SELECT tipo || ':' || cantidad || ':' || "stockAnterior" || '→' || "stockPosterior" FROM "MovimientoStock" WHERE "varianteId" = '${BLUE_RAZZ}' AND "depositoId" = '${G1}' ORDER BY "createdAt" DESC LIMIT 1`,
);
check(ajuste === "AJUSTE_NEGATIVO:2:50→48" && stock(BLUE_RAZZ, G1) === 48, `movimiento ${ajuste}`);

// =============================================================================
console.log("\n   Transferir: 2× Watermelon Ice Galpón 1 → Galpón 2, completar en el momento");
const wmAntes = [stock(WATERMELON, G1), stock(WATERMELON, G2)];
await ir(owner, `/escanear?modo=transferir&deposito=${G1}&destino=${G2}`);
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, codigoDe(WATERMELON), 2);
await owner.waitForFunction(
  () => document.querySelector('ul[aria-label="Productos escaneados"] input')?.value === "2",
);
await clickTexto(owner, "button", "Crear transferencia (2 u.)");
await dialogoAbierto(owner);
await clickTexto(owner, "dialog[@open]//button", "Crear");
await esperarTexto(owner, "Completar ahora");
await shot(owner, "09-mobile-escanear-transferencia-creada");
await clickTexto(owner, "dialog[@open]//button", "Completar ahora");
await esperarTexto(owner, "completada");
check(
  stock(WATERMELON, G1) === wmAntes[0] - 2 && stock(WATERMELON, G2) === wmAntes[1] + 2,
  `Watermelon Ice: Galpón 1 ${wmAntes[0]} → ${stock(WATERMELON, G1)}, Galpón 2 ${wmAntes[1]} → ${stock(WATERMELON, G2)}`,
);

// =============================================================================
console.log(
  "\n4) Compra de 3 productos escaneados, recibida con «actualizar costos»; después anulada",
);
const provId = sql(`SELECT id FROM "Proveedor" WHERE nombre = 'Distribuidora Ejemplo SRL'`);
const productos3 = [MANGO, FRUTILLA, COOL_MINT];
const stockAntes = productos3.map((v) => stock(v, G1));
const costoAntes = productos3.map((v) =>
  sql(`SELECT "precioCosto" FROM "Variante" WHERE id = '${v}'`),
);
const histAntes = Number(sql(`SELECT count(*) FROM "HistorialPrecio"`));
await ir(owner, "/compras/nueva");
await elegir(owner, "Proveedor", "Distribuidora Ejemplo");
await elegir(owner, "Depósito destino", "Galpón 1");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD_MANGO, 4);
await pistola(owner, COD_FRUTILLA, 2);
await pistola(owner, codigoDe(COOL_MINT), 3);
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Ítems de la compra"] > li').length === 3,
  { timeout: 10000 },
);
await escribir(owner, 'input[aria-label="Costo unitario de Ignite V80 — Mango Ice"]', "9100");
await escribir(owner, 'input[aria-label="Costo unitario de Ignite V80 — Frutilla"]', "9200");
await escribir(owner, 'input[aria-label="Costo unitario de Elf Bar BC5000 — Cool Mint"]', "8300");
await escribir(owner, 'input[inputmode="decimal"]:not([aria-label])', "1000").catch(
  () => undefined,
);
await esperar(300);
const totalPantalla = await owner.$eval(
  "body",
  (b) => /Total\s*\$\s*([\d.,]+)/.exec(b.innerText)?.[1],
);
await shot(owner, "10-mobile-compra-nueva");
await clickTexto(owner, "button", "Recibir mercadería");
await dialogoAbierto(owner);
const cambios = await owner.$eval("dialog[open]", (d) => d.innerText.replace(/\s+/g, " "));
check(
  cambios.includes("¿Actualizar los precios de costo") && cambios.includes("→"),
  "el diálogo muestra los cambios de costo antes de recibir",
);
await shot(owner, "11-mobile-compra-recibir-costos");
await clickTexto(owner, "dialog[@open]//button", "Recibir y actualizar costos");
await owner.waitForFunction(() => /^\/compras\/[a-z0-9]{20,}$/.test(location.pathname), {
  timeout: 20000,
});
await owner.waitForNetworkIdle();
const compraId = new URL(owner.url()).pathname.split("/").pop();
const compraDb = sql(
  `SELECT estado || ':' || subtotal || ':' || descuento || ':' || total FROM "Compra" WHERE id = '${compraId}'`,
);
// 4×9100 + 2×9200 + 3×8300 = 36400 + 18400 + 24900 = 79700
check(
  compraDb.startsWith("RECIBIDA:79700.00"),
  `compra ${compraDb} (total calculado en el servidor; en pantalla $${totalPantalla})`,
);
const ingresos = sql(
  `SELECT count(*) || ':' || sum(cantidad) FROM "MovimientoStock" WHERE tipo = 'INGRESO_COMPRA' AND "referenciaTipo" = 'COMPRA' AND "referenciaId" = '${compraId}'`,
);
check(ingresos === "3:9", `3 INGRESO_COMPRA con referencia a la compra (${ingresos} unidades)`);
const histNuevas = Number(sql(`SELECT count(*) FROM "HistorialPrecio"`)) - histAntes;
check(histNuevas === 3, `${histNuevas} filas nuevas en HistorialPrecio`);
const costos = productos3.map((v) => sql(`SELECT "precioCosto" FROM "Variante" WHERE id = '${v}'`));
check(
  costos.join() === "9100.00,9200.00,8300.00",
  `precioCosto ${costoAntes.join("/")} → ${costos.join("/")}`,
);
check(
  productos3.every((v, i) => stock(v, G1) === stockAntes[i] + [4, 2, 3][i]),
  `stock Galpón 1 +4/+2/+3`,
);
await shot(owner, "12-mobile-compra-detalle-recibida");
await clickTexto(owner, "a", "Ver sus 3 movimientos");
await owner.waitForFunction(() => location.pathname === "/movimientos");
await esperarTexto(owner, "Solo los movimientos de");
const filasLedger = await owner.$$eval(
  "main ul li",
  (l) => l.filter((x) => x.innerText.includes("Compra #")).length,
);
const filtroLedger = await owner.$eval('main [role="status"]', (e) =>
  e.innerText.replace(/\s+/g, " "),
);
check(
  filasLedger === 3,
  `el link lleva al ledger filtrado: ${filasLedger} movimientos · «${filtroLedger}»`,
);

await ir(owner, `/compras/${compraId}`);
await clickTexto(owner, "button", "Anular compra");
await dialogoAbierto(owner);
await owner.type("dialog[open] textarea", "Llegó con fallas (E2E)", { delay: 10 });
await clickTexto(owner, "dialog[@open]//button", "Anular");
await esperarTexto(owner, "anulada");
const devoluciones = sql(
  `SELECT count(*) FROM "MovimientoStock" WHERE tipo = 'DEVOLUCION_PROVEEDOR' AND "referenciaId" = '${compraId}'`,
);
check(devoluciones === "3", "anulada → 3 DEVOLUCION_PROVEEDOR");
check(
  productos3.every((v, i) => stock(v, G1) === stockAntes[i]),
  `el stock vuelve: ${productos3.map((v) => stock(v, G1)).join("/")}`,
);
await ir(owner, "/compras");
await shot(owner, "13-mobile-compras-listado");
await ir(owner, `/proveedores/${provId}`);
await esperarTexto(owner, "Historial de compras");
check(
  (await owner.$eval("main", (m) => m.innerText)).includes(`#`),
  "la ficha del proveedor muestra su historial de compras",
);
await shot(owner, "14-mobile-proveedor-historial");

// =============================================================================
console.log("\n   Integración del escáner en otras pantallas (pistola sin foco)");
await ir(owner, "/movimientos/ingreso");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD_MANGO, 2);
await owner.waitForFunction(
  () => document.querySelector('ul[aria-label="Productos a ingresar"] input')?.value === "2",
  { timeout: 8000 },
);
check(true, "/movimientos/ingreso: 2 escaneos → 1 fila con cantidad 2");
await ir(owner, `/movimientos/ajuste?modo=recuento`);
await clickTexto(owner, "button", "Cargar planilla");
await owner.waitForSelector('input[aria-label^="Conteo de"]');
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD_FRUTILLA, 3);
await owner.waitForFunction(
  () =>
    document.querySelector('input[aria-label="Conteo de Ignite V80 — Frutilla"]')?.value === "3",
  { timeout: 8000 },
);
check(true, "/movimientos/ajuste recuento: cada escaneo suma 1 a lo contado (Frutilla = 3)");
await ir(owner, "/movimientos/transferencias/nueva");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD_MANGO);
await owner.waitForSelector('ul[aria-label="Productos a transferir"] li');
check(true, "/movimientos/transferencias/nueva: el escaneo agrega el producto");
await ir(owner, "/productos");
await owner.click('input[type="search"]'); // aunque el foco esté en el buscador
await esperar(1500); // una persona toca el buscador y después aprieta el gatillo
await pistola(owner, COD_MANGO);
await owner.waitForFunction(
  (id) => location.pathname === `/productos/${id}`,
  { timeout: 8000 },
  igniteId,
);
check(true, "/productos: escanear (con foco en el buscador) abre la ficha de Ignite V80");
await ir(owner, "/inventario");
await pistola(owner, codigoDe(COOL_MINT));
await owner.waitForFunction(() => location.pathname.startsWith("/productos/"), { timeout: 8000 });
check(true, "/inventario: escanear abre la ficha del producto");

// =============================================================================
console.log("\n   /configuracion/escaner: «Probar pistola»");
await ir(owner, "/configuracion/escaner");
await owner.click('input[placeholder="Hacé foco acá y escaneá"]');
await pistola(owner, COD_MANGO);
await owner.waitForSelector('ul[aria-label="Lecturas"] li');
const lectura = await owner.$eval('ul[aria-label="Lecturas"] li', (l) =>
  l.innerText.replace(/\s+/g, " "),
);
const campoPrueba = await owner.$eval(
  'input[placeholder="Hacé foco acá y escaneá"]',
  (e) => e.value,
);
check(
  lectura.includes(COD_MANGO) && campoPrueba === "",
  `lectura «${lectura}»; el campo con foco quedó vacío («${campoPrueba}»)`,
);
await owner.type('input[placeholder="Hacé foco acá y escaneá"]', "hola", { delay: 120 });
check(
  (await owner.$eval('input[placeholder="Hacé foco acá y escaneá"]', (e) => e.value)) === "hola",
  "tipeo humano en el mismo campo: llega normal",
);
await shot(owner, "15-mobile-config-escaner");
// El script de consola (eventos sintéticos) también dispara el escáner.
await ir(owner, "/escanear");
await owner.evaluate(
  `${fs.readFileSync("scripts/simular-pistola.js", "utf8")}; simularPistola("${codigoDe(WATERMELON)}")`,
);
await owner.waitForSelector('section[aria-label="Producto"]', { timeout: 8000 });
check(
  (await owner.$eval('section[aria-label="Producto"]', (s) => s.innerText)).includes(
    "Watermelon Ice",
  ),
  "scripts/simular-pistola.js pegado en la consola → el hub muestra Elf Bar BC5000 — Watermelon Ice",
);

// =============================================================================
console.log("\n7) Etiquetas: 6 Code128 en PDF para un producto sin código de fábrica");
await ir(owner, "/productos/nuevo");
const FUNDA = `Funda E2E ${sufijo}`;
await owner.type('input[name="nombre"]', FUNDA, { delay: 20 });
await elegirEn(owner, 'select[name="categoriaId"]', "Accesorios");
await owner.type("#variantes-0-nombre", "Negra", { delay: 20 });
await owner.type("#variantes-0-precioCosto", "1500", { delay: 20 });
await owner.type("#variantes-0-precioVenta", "4990", { delay: 20 });
await clickExacto(owner, "Guardar");
await owner.waitForFunction(() => /^\/productos\/[a-z0-9]{20,}$/.test(location.pathname), {
  timeout: 20000,
});
const fundaId = varianteId(FUNDA, "Negra");
check(Boolean(fundaId) && codigoDe(fundaId) === "", "funda creada sin código de barras");
await ir(owner, `/productos/etiquetas?q=${encodeURIComponent(FUNDA)}`);
await owner.waitForSelector('ul[aria-label="Variantes"] input[type=checkbox]');
await owner.click('ul[aria-label="Variantes"] input[type=checkbox]');
await escribir(owner, `input[aria-label="Cantidad de etiquetas de ${FUNDA} — Negra"]`, "6");
await elegir(owner, "Formato", "65 por hoja");
check(
  (await owner.$eval("main", (m) => m.innerText)).includes("se les asigna un código interno"),
  "aviso: sin código → se asigna uno interno al generar",
);
await shot(owner, "16-mobile-etiquetas");
await clickTexto(owner, "button", "Generar PDF");
await esperarTexto(owner, "PDF con 6 etiquetas");
const codigoInterno = codigoDe(fundaId);
check(/^PRD\d{8}$/.test(codigoInterno), `código interno asignado: ${codigoInterno}`);
const pdfB64 = await owner.evaluate(async (id) => {
  const r = await fetch("/api/etiquetas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      formato: "avery65",
      mostrarPrecio: true,
      items: [{ varianteId: id, cantidad: 6 }],
    }),
  });
  const b = new Uint8Array(await r.arrayBuffer());
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return {
    tipo: r.headers.get("content-type"),
    etiquetas: r.headers.get("x-etiquetas"),
    datos: btoa(s),
  };
}, fundaId);
check(
  pdfB64.tipo === "application/pdf" && pdfB64.etiquetas === "6",
  `POST /api/etiquetas → ${pdfB64.tipo}, ${pdfB64.etiquetas} etiquetas`,
);
const pdfPath = path.join(SHOTS, "etiquetas-avery65.pdf");
fs.writeFileSync(pdfPath, Buffer.from(pdfB64.datos, "base64"));
// Desde otro sitio (el navegador no deja falsear Origin desde la página: se prueba desde Node).
// CSRF: con la cookie de sesión válida (como la mandaría el navegador) pero desde otro sitio.
const cookie = (await owner.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const csrf = await fetch(`${BASE}/api/etiquetas`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://malicioso.example",
    Cookie: cookie,
  },
  body: JSON.stringify({
    formato: "avery65",
    mostrarPrecio: true,
    items: [{ varianteId: fundaId, cantidad: 1 }],
  }),
});
check(
  csrf.status === 403,
  `POST /api/etiquetas con sesión válida pero desde otro origen → ${csrf.status}`,
);
const sinSesion = await fetch(`${BASE}/api/etiquetas`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: "{}",
});
check(sinSesion.status === 401, `POST /api/etiquetas sin sesión → ${sinSesion.status}`);

// =============================================================================
console.log("\n6/7) Cámara (video falso de Chrome): EAN-13 y la etiqueta Code128 impresa");
const MEDIA = path.join(SHOTS, "media");
fs.mkdirSync(MEDIA, { recursive: true });
const ffmpeg = (entrada, salida, filtro) =>
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-i",
    entrada,
    "-vf",
    `${filtro},pad=640:480:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`,
    "-frames:v",
    "10",
    "-r",
    "10",
    salida,
  ]);

// Video 1: EAN-13 de Ignite V80 — Mango Ice.
fs.writeFileSync(
  path.join(MEDIA, "ean13.png"),
  await bwipjs.toBuffer({
    bcid: "ean13",
    text: COD_MANGO,
    scale: 3,
    height: 25,
    includetext: true,
    paddingwidth: 12,
    paddingheight: 8,
    backgroundcolor: "FFFFFF",
  }),
);
ffmpeg(path.join(MEDIA, "ean13.png"), path.join(MEDIA, "ean13.y4m"), "scale=520:-2");

// Video 2: la 1ª etiqueta del PDF (A4 65/hoja: 38,1 × 21,2 mm en 4,65 / 10,7 mm), rasterizada con PDFKit.
execFileSync("qlmanage", ["-t", "-s", "3000", "-o", MEDIA, pdfPath], { stdio: "ignore" });
const pagina = path.join(MEDIA, "etiquetas-avery65.pdf.png");
const anchoPx = Number(
  /pixelWidth: (\d+)/.exec(execFileSync("sips", ["-g", "pixelWidth", pagina]).toString())[1],
);
const mm = anchoPx / 210;
const recorte = `crop=${Math.round(38.1 * mm)}:${Math.round(21.2 * mm)}:${Math.round(4.65 * mm)}:${Math.round(10.7 * mm)}`;
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  pagina,
  "-vf",
  recorte,
  path.join(MEDIA, "etiqueta.png"),
]);
ffmpeg(path.join(MEDIA, "etiqueta.png"), path.join(MEDIA, "etiqueta.y4m"), "scale=600:-2");
check(
  fs.existsSync(path.join(MEDIA, "etiqueta.png")),
  `etiqueta recortada del PDF (${recorte}) → media/etiqueta.png`,
);

async function probarCamara(video, { sinDetectorNativo, esperado, nombre }) {
  const b = await lanzar(video);
  const page = await sesion(b, MOBILE, { sinDetectorNativo });
  await login(page, "dueno1@negocio.com", "DuenoUno2026");
  await ir(page, "/escanear");
  await clickTexto(page, "button", "Cámara");
  await page.waitForSelector("dialog[open][data-estado]");
  // Con el permiso ya concedido arranca directo; si no, pantalla previa → «Activar cámara».
  if ((await page.$eval("dialog[open]", (d) => d.dataset.estado)) === "intro") {
    await clickTexto(page, "dialog[@open]//button", "Activar cámara");
  }
  await page.waitForSelector('dialog[open][data-estado="activo"]', { timeout: 15000 });
  const motor = await page.$eval("dialog[open]", (d) => d.dataset.motor);
  await page.waitForFunction(
    (t) => document.querySelector("dialog[open]")?.innerText.includes(t),
    { timeout: 20000 },
    esperado,
  );
  check(true, `[motor ${motor}] la cámara detecta y resuelve → «${esperado}»`);
  const vibro = await page.evaluate(() => typeof navigator.vibrate === "function");
  await shot(page, `${nombre}-detectado`);
  const vivos = await page.evaluate(
    () =>
      window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length,
  );
  check(
    vivos === 1,
    `con la cámara abierta: ${vivos} track de video activo (vibrate disponible: ${vibro})`,
  );
  // Pestaña oculta → se libera; visible de nuevo → se reanuda.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await esperar(300);
  const trasOcultar = await page.evaluate(() =>
    window.__streams.flatMap((s) => s.getTracks()).every((t) => t.readyState === "ended"),
  );
  check(trasOcultar, "pestaña oculta (visibilitychange) → todos los tracks «ended»");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForSelector('dialog[open][data-estado="activo"]', { timeout: 10000 });
  await page.click('dialog[open] button[aria-label="Cerrar cámara"]');
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await esperar(300);
  const estado = await page.evaluate(() => {
    const tracks = window.__streams.flatMap((s) => s.getTracks());
    return {
      total: tracks.length,
      terminados: tracks.filter((t) => t.readyState === "ended").length,
      video: document.querySelector("video")?.srcObject ?? null,
    };
  });
  check(
    estado.total >= 2 && estado.terminados === estado.total && estado.video === null,
    `al cerrar: ${estado.terminados}/${estado.total} tracks «ended» y el <video> sin stream → cámara liberada`,
  );
  const ficha = await page
    .$eval('section[aria-label="Producto"]', (s) => s.innerText)
    .catch(() => "");
  check(ficha.includes(esperado), `el hub muestra la ficha de «${esperado}» (Consultar)`);
  await b.close();
  return motor;
}

// Sin permiso concedido: pantalla previa explicando por qué, y si se niega, cómo habilitarlo.
{
  const b = await lanzar(path.join(MEDIA, "ean13.y4m"), { aceptarPermiso: false });
  const page = await sesion(b, MOBILE);
  await login(page, "dueno1@negocio.com", "DuenoUno2026");
  await ir(page, "/escanear");
  await clickTexto(page, "button", "Cámara");
  await page.waitForSelector('dialog[open][data-estado="intro"]');
  check(true, "sin permiso previo → pantalla que explica para qué se usa la cámara");
  await shot(page, "17-mobile-camara-intro");
  await clickTexto(page, "dialog[@open]//button", "Activar cámara");
  const estado = await page
    .waitForSelector('dialog[open][data-estado="denegado"]', { timeout: 10000 })
    .then(() => "denegado")
    .catch(() => page.$eval("dialog[open]", (d) => d.dataset.estado));
  const texto = await page.$eval("dialog[open]", (d) => d.innerText);
  check(
    estado === "denegado" && texto.includes("Permitir"),
    `permiso negado → estado «${estado}» con instrucciones para habilitarlo`,
  );
  await shot(page, "17b-mobile-camara-permiso-denegado");
  const vivos = await page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).length);
  check(vivos === 0, `sin permiso no queda ninguna cámara abierta (${vivos} tracks)`);
  await b.close();
}

const motor1 = await probarCamara(path.join(MEDIA, "ean13.y4m"), {
  esperado: "Ignite V80 — Mango Ice",
  nombre: "18-mobile-camara-ean13",
});
const motor2 = await probarCamara(path.join(MEDIA, "etiqueta.y4m"), {
  esperado: `${FUNDA} — Negra`,
  nombre: "18c-mobile-camara-etiqueta-code128",
  sinDetectorNativo: motor1 === "nativo",
});
check(
  motor1 !== motor2 || motor1 === "zxing",
  `motores probados: ${motor1} (EAN-13) y ${motor2} (etiqueta Code128)`,
);

// =============================================================================
console.log("\n8) Empleado (solo Ventas/Inventario): modos bloqueados con candado");
const emp = await sesion(browser, MOBILE);
await login(emp, "empleado@negocio.com", "Empleado2026");
await ir(emp, "/escanear");
const modos = await emp.$$eval('[role="tab"]', (ts) =>
  ts.map((t) => `${t.textContent.trim()}${t.getAttribute("aria-disabled") ? "🔒" : ""}`),
);
check(
  modos.join() === "Consultar,Ingresar🔒,Contar🔒,Transferir🔒,Vender🔒",
  `modos: ${modos.join(" · ")}`,
);
await clickTexto(emp, "button", "Contar");
await esperarTexto(emp, "Necesitás permiso para editar en Movimientos");
check(
  !new URL(emp.url()).searchParams.has("modo"),
  "tocar un modo bloqueado explica por qué y no cambia de modo",
);
await shot(emp, "19-mobile-escanear-empleado-bloqueado");
await ir(emp, "/escanear?modo=ingresar");
check(
  (await emp.$eval('[aria-selected="true"]', (t) => t.textContent.trim())) === "Consultar",
  "?modo=ingresar sin permiso → queda en Consultar",
);
await ir(emp, "/compras");
check(
  new URL(emp.url()).pathname === "/sin-acceso",
  `/compras sin permiso → ${new URL(emp.url()).pathname}`,
);

// Desktop
const desk = await sesion(browser, DESKTOP);
await login(desk, "dueno1@negocio.com", "DuenoUno2026");
for (const [ruta, nombre] of [
  ["/escanear?modo=ingresar", "20-desktop-escanear"],
  ["/compras", "21-desktop-compras"],
  [`/compras/${compraId}`, "22-desktop-compra-anulada"],
  ["/proveedores", "23-desktop-proveedores"],
  ["/productos/etiquetas?sinCodigo=1", "24-desktop-etiquetas"],
  ["/configuracion/escaner", "25-desktop-config-escaner"],
]) {
  await ir(desk, ruta);
  await shot(desk, nombre);
}

await browser.close();
console.log(fallos === 0 ? "\nE2E OK ✅" : `\n${fallos} verificación(es) fallaron ❌`);
process.exit(fallos === 0 ? 0 : 1);
