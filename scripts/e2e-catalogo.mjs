/**
 * E2E del Prompt 3 (catálogo, inventario, movimientos) por la UI real, con
 * Chrome headless. Verifica también contra la DB (psql dentro del contenedor).
 *
 * Requiere el build de producción corriendo contra una DB RECIÉN sembrada:
 *   pnpm build && pnpm start -p 3457     # con DATABASE_URL de una DB descartable
 *   E2E_DB=gestion_verif pnpm test:e2e:catalogo
 * Screenshots en verificacion/prompt3/ (ignorado por git).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import puppeteer from "puppeteer-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3457";
const DB = process.env.E2E_DB ?? "gestion_verif";
const SHOTS = process.argv[2] ?? "verificacion/prompt3";
const MANIFEST = JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8"));
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
const actionId = (n) => Object.entries(MANIFEST.node).find(([, v]) => v.exportedName === n)?.[0];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function ean13(base12) {
  const s = [...base12].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (s % 10)) % 10}`;
}

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MOBILE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

async function sesion(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
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

async function ir(page, ruta) {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle0" });
}

async function shot(page, nombre) {
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
  await page.screenshot({ path: path.join(SHOTS, `${nombre}.png`) });
}

/** Reemplaza el contenido de un input (select() es más confiable que el triple click). */
async function escribir(page, selector, texto) {
  await page.$eval(selector, (e) => {
    e.focus();
    e.select();
  });
  await page.keyboard.press("Backspace");
  await page.type(selector, texto);
  // page.type tipea a 0 ms entre teclas, como una pistola: el detector de escaneo retiene
  // las teclas hasta 150 ms por si es una ráfaga. Una persona no lo nota; el test espera.
  await esperar(200);
}

async function elegirOpcion(page, selector, textoOpcion) {
  const valor = await page.$eval(
    selector,
    (s, t) => [...s.options].find((o) => o.textContent.trim() === t)?.value,
    textoOpcion,
  );
  if (valor === undefined) throw new Error(`No hay opción "${textoOpcion}" en ${selector}`);
  await page.select(selector, valor);
}

/** Espera a que abra un <dialog> y a que termine su animación de entrada (~180 ms). */
async function dialogoAbierto(page) {
  await page.waitForSelector("dialog[open]");
  await esperar(350);
}

/** Click en el primer elemento VISIBLE con ese texto (desktop y mobile pueden tener versiones ocultas). */
async function clickTexto(page, tag, texto) {
  for (const el of await page.$$(`xpath/.//${tag}[contains(normalize-space(.), '${texto}')]`)) {
    if (await el.isVisible()) return el.click();
  }
  throw new Error(`No hay ${tag} visible con el texto "${texto}"`);
}
async function esperarTexto(page, texto, timeout = 15000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, texto);
  } catch (e) {
    // Diagnóstico: qué había en pantalla en vez del texto esperado.
    await page.screenshot({ path: path.join(SHOTS, "zz-fallo-esperarTexto.png") });
    console.log(`  ✘ no apareció «${texto}». Toasts: ${JSON.stringify(await textoToast(page))}`);
    throw e;
  }
}
const textoToast = (page) =>
  page.$$eval('[role="status"], [role="alert"]', (els) =>
    els
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .join(" | "),
  );

async function accion(page, nombre, args) {
  return page.evaluate(
    async (id, a) => {
      const r = await fetch("/", {
        method: "POST",
        headers: {
          "Next-Action": id,
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
        },
        body: JSON.stringify([a]),
      });
      return (await r.text()).split("\n").find((l) => l.includes('"ok"')) ?? "";
    },
    actionId(nombre),
    args,
  );
}

const sufijo = String(Date.now()).slice(-5);
const NOMBRE = `Vape E2E ${sufijo}`;
const SABORES = ["Mango Ice", "Blueberry Ice", "Cola", "Menta", "Sandía"];
const CODIGOS = SABORES.map((_, i) => ean13(`7795${sufijo}${String(i).padStart(3, "0")}`));
const [G1, G2] = sql(
  `SELECT id FROM "Deposito" WHERE activo ORDER BY "esPrincipal" DESC, nombre`,
).split("\n");

// =============================================================================
console.log(
  "\n1) Crear un vape con 5 sabores (EAN-13) desde el formulario; código repetido → error claro",
);
const owner = await sesion(DESKTOP);
await login(owner, "dueno1@negocio.com", "DuenoUno2026");
await ir(owner, "/productos/nuevo");
await owner.type('input[name="nombre"]', NOMBRE);
await elegirOpcion(owner, 'select[name="categoriaId"]', "Vapes");
await elegirOpcion(owner, 'select[name="marcaId"]', "Elf Bar");
await owner.type("#variantes-0-nombre", SABORES[0]);
await owner.type("#variantes-0-codigoBarras", CODIGOS[0]);
await owner.type("#variantes-0-precioCosto", "7000");
await owner.type("#variantes-0-precioVenta", "13000");
await escribir(owner, "#variantes-0-stockMinimo", "10");
for (let i = 1; i < 5; i++) {
  await owner.click('button[aria-label="Duplicar variante 1"]'); // misma info, cambiás sabor y código
  await owner.waitForSelector(`#variantes-${i}-nombre`);
  await owner.type(`#variantes-${i}-nombre`, SABORES[i]);
  await owner.type(`#variantes-${i}-codigoBarras`, i === 4 ? CODIGOS[0] : CODIGOS[i]); // el 5º repite el del 1º
}
check(
  (await owner.$eval("#variantes-3-precioVenta", (e) => e.value)) === "13000",
  "«Duplicar fila» copia precios y mínimo (el sabor y el código quedan vacíos)",
);
await clickTexto(owner, "button", "Guardar y cargar stock");
await owner.waitForSelector("#variantes-4-codigoBarras-error");
const errRepetido = await owner.$eval("#variantes-4-codigoBarras-error", (e) => e.textContent);
check(
  errRepetido.includes("Código repetido"),
  `mismo código en dos sabores del formulario → "${errRepetido}"`,
);
await shot(owner, "01-desktop-form-codigo-repetido");
// Código que ya existe en la DB (del seed): la validación en vivo lo marca antes de guardar.
const codigoSeed = sql(
  `SELECT "codigoBarras" FROM "Variante" v JOIN "Producto" p ON p.id = v."productoId" WHERE p.nombre = 'Ignite V80' AND v.nombre = 'Mango Ice'`,
);
await escribir(owner, "#variantes-4-codigoBarras", codigoSeed);
await owner.waitForFunction(
  () =>
    document
      .querySelector("#variantes-4-codigoBarras-error")
      ?.textContent?.includes("Ya pertenece"),
  { timeout: 10000 },
);
const errDb = await owner.$eval("#variantes-4-codigoBarras-error", (e) => e.textContent);
check(
  errDb === "Ya pertenece a Ignite V80 — Mango Ice",
  `código de otro producto (verificación en vivo, debounce) → "${errDb}"`,
);
await shot(owner, "02-desktop-form-codigo-de-otro-producto");
await escribir(owner, "#variantes-4-codigoBarras", CODIGOS[4]);
await esperar(700);
await Promise.all([
  owner.waitForNavigation({ waitUntil: "networkidle0" }),
  clickTexto(owner, "button", "Guardar y cargar stock"),
]);
check(
  new URL(owner.url()).pathname === "/movimientos/ingreso",
  `«Guardar y cargar stock» lleva a ${new URL(owner.url()).pathname}`,
);
await owner.waitForSelector('ul[aria-label="Productos a ingresar"] > li'); // navegación client-side: esperar el contenido
const filasPrecargadas = await owner.$$eval(
  'ul[aria-label="Productos a ingresar"] > li',
  (l) => l.length,
);
check(
  filasPrecargadas === 5,
  `el ingreso manual viene con las ${filasPrecargadas} variantes precargadas`,
);
const productoId = sql(`SELECT id FROM "Producto" WHERE nombre = '${NOMBRE}'`);
const mangoId = sql(
  `SELECT id FROM "Variante" WHERE "productoId" = '${productoId}' AND nombre = 'Mango Ice'`,
);
check(
  sql(
    `SELECT count(*) FROM "Variante" WHERE "productoId" = '${productoId}' AND sku ~ '^PRD-[A-Z2-9]{6}$'`,
  ) === "5",
  "5 variantes creadas con SKU autogenerado PRD-XXXXXX",
);

// =============================================================================
console.log(
  "\n3) Ingreso manual: 30 Mango Ice a Galpón 1 y 20 a Galpón 2 → inventario 30 | 20 | 50",
);
for (const s of SABORES.slice(1)) await owner.click(`button[aria-label="Quitar ${NOMBRE} — ${s}"]`);
await escribir(owner, `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`, "30");
await clickTexto(owner, "button", "Registrar ingreso");
await esperarTexto(owner, "Listo: 30 unidades ingresaron a Galpón 1");
check(true, "ingreso de 30 a Galpón 1 registrado");
await owner.select("select", G2);
await owner.type("#picker-ingreso", CODIGOS[0]);
await owner.keyboard.press("Enter"); // como la pistola: código + Enter → se agrega solo
await owner.waitForSelector(`input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`);
check(true, "escanear el código + Enter agrega el producto directo (sin elegir de la lista)");
await escribir(owner, `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`, "20");
await escribir(owner, "textarea", "Stock inicial Galpón 2");
await clickTexto(owner, "button", "Registrar ingreso");
await esperarTexto(owner, "Listo: 20 unidades ingresaron a Galpón 2");
await ir(owner, `/inventario?q=${CODIGOS[0]}`);
const celdas = await owner.$$eval("table tbody tr", (trs) =>
  trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
);
const filaMango = celdas.find((c) => c[0]?.includes("Mango Ice"));
check(
  filaMango?.[2] === "30" && filaMango?.[3] === "20" && filaMango?.[4] === "50",
  `/inventario: ${filaMango?.slice(2, 5).join(" | ")} (Galpón 1 | Galpón 2 | Total)`,
);
await ir(owner, `/productos/${productoId}`);
const matriz = await owner.$$eval('section[aria-labelledby="matriz"] tbody tr', (trs) =>
  trs.map((tr) => [
    tr.querySelector("th")?.textContent.trim(),
    ...[...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
  ]),
);
const mm = matriz.find((r) => r[0] === "Mango Ice");
check(
  mm?.[1] === "30" && mm?.[2] === "20" && mm?.[3] === "50",
  `matriz de la ficha: Mango Ice ${mm?.slice(1).join(" | ")}`,
);
await shot(owner, "03-desktop-ficha-matriz");

// =============================================================================
console.log(
  "\n4) Transferencias: 10 de Galpón 1 a Galpón 2; 100 → stock insuficiente; pendiente que falla queda PENDIENTE",
);
await ir(owner, `/movimientos/transferencias/nueva?variante=${mangoId}&origen=${G1}`);
await escribir(owner, `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`, "10");
await clickTexto(owner, "button", "Crear transferencia");
await owner.waitForSelector("xpath/.//button[contains(., 'Completar transferencia')]");
await clickTexto(owner, "button", "Completar transferencia");
await dialogoAbierto(owner);
await owner.click("xpath/.//dialog[@open]//button[normalize-space(.)='Completar']");
await esperarTexto(owner, "completada");
await ir(owner, `/inventario?q=${CODIGOS[0]}`);
const tras = (
  await owner.$$eval("table tbody tr", (trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
  )
).find((c) => c[0]?.includes("Mango"));
check(
  tras?.[2] === "20" && tras?.[3] === "30" && tras?.[4] === "50",
  `después de transferir 10: ${tras?.slice(2, 5).join(" | ")}`,
);

await ir(owner, `/movimientos/transferencias/nueva?variante=${mangoId}&origen=${G1}`);
await escribir(owner, `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`, "100");
check(
  await owner.$eval(
    `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`,
    (e) => e.getAttribute("aria-invalid") === "true",
  ),
  "la UI marca en rojo que 100 no alcanza (hay 20)",
);
await clickTexto(owner, "button", "Crear transferencia");
await esperarTexto(owner, "se piden 100");
const toast100 = await textoToast(owner);
check(
  toast100.includes("Stock insuficiente en Galpón 1") && toast100.includes("hay 20, se piden 100"),
  `crear con 100 → "${toast100.match(/Stock insuficiente[^|]*/)?.[0]?.trim()}"`,
);
check(
  sql(
    `SELECT count(*) FROM "Transferencia" t JOIN "TransferenciaItem" i ON i."transferenciaId" = t.id WHERE i.cantidad = 100`,
  ) === "0",
  "no se creó ninguna transferencia de 100",
);

// Pendiente que se queda sin stock antes de completarse.
await escribir(owner, `input[aria-label="Cantidad de ${NOMBRE} — Mango Ice"]`, "15");
await clickTexto(owner, "button", "Crear transferencia");
await owner.waitForSelector("xpath/.//button[contains(., 'Completar transferencia')]");
const urlT15 = owner.url();
async function ajusteSimple(real, motivo) {
  await ir(owner, `/movimientos/ajuste?variante=${mangoId}&deposito=${G1}`);
  await owner.type('input[inputmode="numeric"]', real);
  await owner.type("textarea", motivo);
  await clickTexto(owner, "button", "Revisar ajuste");
  await dialogoAbierto(owner);
  await clickTexto(owner, "button", "Aplicar ajuste");
  await esperarTexto(owner, "Stock ajustado");
}
await ajusteSimple("5", "Rotura en el galpón");
await owner.goto(urlT15, { waitUntil: "networkidle0" });
await clickTexto(owner, "button", "Completar transferencia");
await dialogoAbierto(owner);
await owner.click("xpath/.//dialog[@open]//button[normalize-space(.)='Completar']");
await esperarTexto(owner, "Sigue pendiente");
const toastFalla = (await textoToast(owner)).match(/No se pudo completar[^|]*/)?.[0]?.trim();
await owner.reload({ waitUntil: "networkidle0" });
check(
  (await owner.$eval("main", (m) => m.innerText)).includes("Pendiente"),
  `completar sin stock → "${toastFalla}" y sigue Pendiente`,
);
await shot(owner, "04-desktop-transferencia-pendiente-sin-stock");
await ajusteSimple("20", "Recupero de unidades");

// =============================================================================
console.log(
  "\n5) Recuento: sistema 20, conteo 18 → AJUSTE_NEGATIVO por 2; el ledger muestra 20 → 18",
);
await ir(owner, "/movimientos/ajuste?modo=recuento");
await clickTexto(owner, "button", "Cargar planilla");
await owner.waitForSelector(`input[aria-label="Conteo de ${NOMBRE} — Mango Ice"]`);
await owner.type(`input[aria-label="Conteo de ${NOMBRE} — Mango Ice"]`, "18");
await owner.type("textarea", "Recuento mensual");
await clickTexto(owner, "button", "Revisar diferencias");
await dialogoAbierto(owner);
const resumenDif = await owner.$eval("dialog[open] ul", (u) => u.innerText.replace(/\s+/g, " "));
check(
  resumenDif.includes("20 → 18") && resumenDif.includes("(-2)"),
  `confirmación con resumen: "${resumenDif}"`,
);
await clickTexto(owner, "button", "Aplicar recuento");
await esperarTexto(owner, "Recuento aplicado");
await ir(owner, `/movimientos?varianteId=${mangoId}&depositoId=${G1}`);
const primera = await owner.$eval("table tbody tr", (tr) =>
  [...tr.querySelectorAll("td")].map((td) => td.innerText.trim().replace(/\s+/g, " ")),
);
check(
  primera[1] === "Ajuste −" &&
    primera[4] === "-2" &&
    primera[5] === "20 → 18" &&
    primera[8].startsWith("Recuento mensual"),
  `ledger: ${primera[1]} · ${primera[4]} · ${primera[5]} · "${primera[8]}"`,
);
await shot(owner, "05-desktop-ledger-recuento");

// =============================================================================
console.log("\n7) Aumento masivo del 10% al precio de venta de la categoría Vapes");
const variantesVapes = Number(
  sql(
    `SELECT count(*) FROM "Variante" v JOIN "Producto" p ON p.id = v."productoId" JOIN "Categoria" c ON c.id = p."categoriaId" WHERE c.nombre = 'Vapes' AND v."deletedAt" IS NULL AND p."deletedAt" IS NULL`,
  ),
);
const histAntes = Number(sql(`SELECT count(*) FROM "HistorialPrecio"`));
await ir(owner, "/productos");
await clickTexto(owner, "button", "Aumento masivo");
await dialogoAbierto(owner);
await elegirOpcion(owner, "dialog[open] select", "Vapes");
await owner.type('dialog[open] input[inputmode="decimal"]', "10");
await clickTexto(owner, "button", "Previsualizar");
await esperarTexto(owner, "Afecta a");
await shot(owner, "06-desktop-aumento-previsualizacion");
await clickTexto(owner, "button", `Aplicar a ${variantesVapes} variantes`);
await esperarTexto(owner, "Precios actualizados");
const histNuevas = Number(sql(`SELECT count(*) FROM "HistorialPrecio"`)) - histAntes;
check(
  histNuevas === variantesVapes,
  `${variantesVapes} variantes de Vapes → ${histNuevas} filas nuevas en HistorialPrecio`,
);
const precioMango = sql(
  `SELECT "precioVentaAnterior" || ' → ' || "precioVentaNuevo" FROM "HistorialPrecio" WHERE "varianteId" = '${mangoId}' ORDER BY "createdAt" DESC LIMIT 1`,
);
check(precioMango === "13000.00 → 14300.00", `Mango Ice: ${precioMango}`);

// =============================================================================
console.log("\n2) CSV de 20 filas con 2 errores → no se inserta nada y el reporte marca las 2");
const lineas = [
  "producto;marca;categoria;variante;sku;codigo_barras;precio_costo;precio_venta;stock_minimo",
];
for (let i = 1; i <= 20; i++) {
  lineas.push(
    `CSV ${sufijo} ${Math.ceil(i / 5)};Genérica;Líquidos;Sabor ${i};;${i === 12 ? CODIGOS[1] : ean13(`7794${sufijo}${String(i).padStart(3, "0")}`)};${i === 4 ? "abc" : "1.500,50"};2990;3`,
  );
}
const archivo = path.resolve(SHOTS, `import-${sufijo}.csv`);
fs.writeFileSync(archivo, lineas.join("\r\n"), "latin1");
const productosAntes = sql(`SELECT count(*) FROM "Producto"`);
await ir(owner, "/productos/importar");
const inputArchivo = await owner.$("#archivo-csv");
await inputArchivo.uploadFile(archivo);
await esperarTexto(owner, "con error");
const filasRojas = await owner.$$eval("table tbody tr", (trs) =>
  trs
    .filter((tr) => tr.className.includes("danger"))
    .map((tr) => tr.innerText.replace(/\s+/g, " ").trim()),
);
check(filasRojas.length === 2, `reporte: 2 filas en rojo`);
for (const f of filasRojas) console.log(`     ${f}`);
check(
  await owner.$eval("xpath/.//button[contains(., 'errores')]", (b) => b.disabled),
  "el botón de importar queda deshabilitado (es todo o nada)",
);
check(sql(`SELECT count(*) FROM "Producto"`) === productosAntes, "no se insertó nada");
await shot(owner, "07-desktop-importacion-con-errores");

// =============================================================================
console.log("\n8) Empleado con SOLO «ver» en Inventario");
const empleadoId = sql(`SELECT id FROM "Usuario" WHERE email = 'empleado@negocio.com'`);
await ir(owner, `/usuarios/${empleadoId}/permisos`);
const toggle = async (etiqueta, quiero) => {
  const sel = `xpath/.//label[.//span[normalize-space()='${etiqueta}']]//button[@role='switch']`;
  const actual = await owner.$eval(sel, (b) => b.getAttribute("aria-checked") === "true");
  if (actual !== quiero) await owner.click(sel);
};
await toggle("Ver Ventas", false);
await toggle("Crear Inventario", false);
await toggle("Ver Inventario", true);
await clickTexto(owner, "button", "Guardar cambios");
await esperarTexto(owner, "Permisos guardados");
check(
  sql(
    `SELECT string_agg(modulo || ':' || "puedeVer" || "puedeCrear" || "puedeEditar", ',' ORDER BY modulo) FROM "PermisoUsuario" WHERE "usuarioId" = '${empleadoId}' AND "puedeVer"`,
  ) === "INVENTARIO:truefalsefalse",
  "permisos del empleado: solo INVENTARIO → ver",
);

const emp = await sesion(DESKTOP);
await login(emp, "empleado@negocio.com", "Empleado2026");
await ir(emp, "/inventario");
// textContent (no innerText): la etiqueta va en mayúsculas por CSS y innerText devuelve "VALOR A COSTO".
const textoInv = (await emp.$eval("main", (m) => m.textContent)).toLowerCase();
const textoInvOwner = await (async () => {
  await ir(owner, "/inventario");
  return (await owner.$eval("main", (m) => m.textContent)).toLowerCase();
})();
check(
  textoInvOwner.includes("valor a costo") && textoInvOwner.includes("valor costo"),
  "control: con el mismo chequeo, el OWNER SÍ ve la tarjeta y la columna de valorización",
);
check(
  !textoInv.includes("valor a costo") && !textoInv.includes("valor costo"),
  "no ve la valorización (ni la tarjeta ni la columna)",
);
check(
  (await emp.$$('button[aria-label^="Ajustar stock"]')).length === 0,
  "no ve botones «Ajustar»",
);
check((await emp.$$('a[aria-label^="Transferir"]')).length === 0, "no ve botones «Transferir»");
check(
  (await emp.$$('a[aria-label^="Movimientos de"]')).length === 0,
  "no ve «Ver movimientos» (no tiene el módulo)",
);
const csvEmp = await emp.evaluate(
  async () => (await (await fetch("/api/inventario/exportar")).text()).split("\n")[0],
);
check(!csvEmp.includes("valor_costo"), "el CSV exportado tampoco trae costos");
const rAjuste = await accion(emp, "ajusteAction", {
  depositoId: G1,
  varianteId: mangoId,
  cantidadReal: 0,
  motivo: "robo hormiga",
});
check(rAjuste.includes('"code":"FORBIDDEN"'), `ajusteAction → ${rAjuste.replace(/^\d+:/, "")}`);
const rTransf = await accion(emp, "crearTransferenciaAction", {
  depositoOrigenId: G1,
  depositoDestinoId: G2,
  items: [{ varianteId: mangoId, cantidad: 1 }],
});
check(rTransf.includes('"code":"FORBIDDEN"'), "crearTransferenciaAction → FORBIDDEN");
const rPrecio = await accion(emp, "aplicarAumentoAction", {
  filtro: {},
  porcentaje: 50,
  aplicarA: "venta",
  redondeo: 1,
});
check(rPrecio.includes('"code":"FORBIDDEN"'), "aplicarAumentoAction → FORBIDDEN");
check(
  sql(
    `SELECT cantidad FROM "Stock" WHERE "varianteId" = '${mangoId}' AND "depositoId" = '${G1}'`,
  ) === "18",
  "el stock no cambió (sigue en 18)",
);
await ir(emp, "/movimientos");
check(new URL(emp.url()).pathname === "/sin-acceso", "/movimientos → /sin-acceso");
await ir(emp, "/movimientos/ajuste");
check(new URL(emp.url()).pathname === "/sin-acceso", "/movimientos/ajuste → /sin-acceso");
await ir(emp, "/inventario");
await shot(emp, "08-desktop-empleado-solo-ver");
const empMobile = await sesion(MOBILE);
await login(empMobile, "empleado@negocio.com", "Empleado2026");
await ir(empMobile, `/inventario?q=${CODIGOS[0]}`);
await shot(empMobile, "09-mobile-empleado-inventario");

// =============================================================================
console.log("\n9) Screenshots de inventario y del resto de las pantallas (375px y 1440px)");
await ir(owner, "/inventario");
await shot(owner, "10-desktop-inventario");
await ir(owner, "/inventario?agruparPorProducto=producto");
await shot(owner, "11-desktop-inventario-por-producto");
await ir(owner, "/productos");
await owner.click(`button[aria-label="Ver variantes de ${NOMBRE}"]`).catch(() => undefined);
await shot(owner, "12-desktop-productos-expandido");
await ir(owner, "/configuracion/depositos");
await shot(owner, "13-desktop-depositos");

const om = await sesion(MOBILE);
await login(om, "dueno1@negocio.com", "DuenoUno2026");
await ir(om, "/inventario");
await shot(om, "14-mobile-inventario");
const tieneValor = (await om.$eval("main", (m) => m.textContent))
  .toLowerCase()
  .includes("valor a costo");
check(tieneValor, "el OWNER sí ve la valorización");
await ir(om, "/inventario?soloBajoMinimo=1");
await shot(om, "15-mobile-inventario-bajo-minimo");
await ir(om, "/productos");
await shot(om, "16-mobile-productos");
await ir(om, `/productos/${productoId}`);
await shot(om, "17-mobile-ficha");
await ir(om, `/productos/${productoId}/editar`);
await shot(om, "18-mobile-form-edicion");
await ir(om, "/movimientos");
await shot(om, "19-mobile-ledger");
await ir(om, "/movimientos/ajuste?modo=recuento");
await clickTexto(om, "button", "Cargar planilla");
await om.waitForSelector('input[aria-label^="Conteo de"]');
await shot(om, "20-mobile-recuento");
await ir(om, "/movimientos/transferencias");
await shot(om, "21-mobile-transferencias");
await om.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await ir(om, "/inventario");
await shot(om, "22-mobile-inventario-dark");

await browser.close();
fs.rmSync(archivo, { force: true });
console.log(fallos === 0 ? "\nE2E CATÁLOGO OK ✅" : `\n${fallos} verificación(es) fallaron ❌`);
process.exit(fallos === 0 ? 0 : 1);
