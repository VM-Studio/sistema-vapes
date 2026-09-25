/**
 * E2E del Prompt 5 (POS, cobro, fiado, devoluciones, anulación, clientes y
 * comprobantes) por la UI real, con Chrome headless.
 *
 * Requiere el build de producción corriendo contra una DB RECIÉN sembrada:
 *   pnpm build && pnpm start -p 3457     # con DATABASE_URL de una DB descartable
 *   E2E_DB=gestion_verif pnpm test:e2e:ventas
 * Screenshots en verificacion/prompt5/ (ignorado por git).
 */
import path from "node:path";

import {
  accion,
  BASE,
  clickSelector,
  clickTexto,
  crearVerificador,
  DESKTOP,
  elegirEn,
  esperar,
  esperarTexto,
  escribir,
  ir,
  lanzar,
  login,
  MOBILE,
  pistola,
  sql,
} from "./e2e-comun.mjs";

const SHOTS = path.resolve(process.argv[2] ?? "verificacion/prompt5");
const { check, sesion, shot, estado } = crearVerificador(SHOTS);

const COD = {
  mango: "7790001000019",
  frutilla: "7790001000026", // Strawberry Watermelon
  cargador: "7790003000017",
  grape: "7790001000040",
  coolMint: "7790002000032",
};
const G1 = sql(`SELECT id FROM "Deposito" WHERE "esPrincipal"`);
const filas = (page) => page.$$eval('ul[aria-label="Productos de la venta"] > li', (l) => l.length);
const cantidadDe = (page, nombre) =>
  page.$eval(`input[aria-label="Cantidad de ${nombre}"]`, (e) => e.value).catch(() => null);

const browser = await lanzar();

// =============================================================================
console.log("\n0) Navegación: «Ventas» de la barra inferior abre el punto de venta");
const owner = await sesion(browser, MOBILE);
await login(owner, "dueno1@negocio.com", "DuenoUno2026");
await ir(owner, "/");
const hrefVentas = await owner.$eval(
  'nav[aria-label="Navegación inferior"] a[href^="/ventas"]',
  (a) => a.getAttribute("href"),
);
check(hrefVentas === "/ventas/nueva", `el ítem Ventas apunta a ${hrefVentas}`);
await clickSelector(owner, 'nav[aria-label="Navegación inferior"] a[href="/ventas/nueva"]');
await owner.waitForSelector(
  'ul[aria-label="Productos de la venta"], section[aria-label="Carrito"]',
);
const activo = await owner.$eval(
  'nav[aria-label="Navegación inferior"] a[href="/ventas/nueva"]',
  (a) => a.getAttribute("aria-current"),
);
check(activo === "page", "…y queda marcado como activo");
await elegirEn(owner, 'select[aria-label="Depósito de venta"]', "Galpón 1");

// =============================================================================
console.log(
  "\n8) Pistola en /ventas/nueva: 3 escaneos del mismo sabor → 1 fila × 3; con foco en «notas» no se contamina",
);
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD.mango, 3);
await owner.waitForFunction(
  () =>
    document.querySelector('input[aria-label="Cantidad de Ignite V80 — Mango Ice"]')?.value === "3",
  { timeout: 10000 },
);
check(
  (await filas(owner)) === 1,
  `1 fila, cantidad ${await cantidadDe(owner, "Ignite V80 — Mango Ice")}`,
);
await clickSelector(owner, "textarea");
await owner.keyboard.type("Pidió bolsa", { delay: 60 });
await pistola(owner, COD.frutilla);
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos de la venta"] > li').length === 2,
  { timeout: 10000 },
);
const notas = await owner.$eval("textarea", (t) => t.value);
check(
  notas === "Pidió bolsa",
  `escaneo con foco en «Notas» → se agregó el producto y las notas quedaron «${notas}»`,
);
// Mango vuelve a 1 (con el botón −) y se suma el cargador.
await clickSelector(owner, 'button[aria-label="Una menos de Ignite V80 — Mango Ice"]');
await clickSelector(owner, 'button[aria-label="Una menos de Ignite V80 — Mango Ice"]');
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD.cargador);
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos de la venta"] > li').length === 3,
);
const totalPos = await owner.$eval('[data-testid="total-pos"]', (e) => e.textContent.trim());
check(
  /40\.900/.test(totalPos),
  `3 productos (1 Mango + 1 Frutilla + 1 cargador) → total ${totalPos}`,
);
await shot(owner, "01-mobile-pos-carrito");
// Se cierra la app en medio de la venta: al volver, el carrito sigue ahí (localStorage).
await owner.reload({ waitUntil: "networkidle0" });
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos de la venta"] > li').length === 3,
  { timeout: 10000 },
);
check(
  (await owner.$eval("textarea", (t) => t.value)) === "Pidió bolsa",
  "recargar la página no pierde la venta en curso (3 productos y las notas)",
);

// =============================================================================
console.log("\n1) Pago partido: $10.000 efectivo + resto transferencia con referencia");
await clickTexto(owner, "button", "Cobrar");
await owner.waitForSelector("dialog[open] [data-testid='total-cobro']", { visible: true });
await escribir(owner, 'dialog[open] input[aria-label="Efectivo recibido"]', "10000");
await clickTexto(owner, "dialog[@open]//button", "Agregar medio de pago");
await owner.waitForSelector('dialog[open] input[aria-label="Monto Transferencia"]');
const montoTransf = await owner.$eval(
  'dialog[open] input[aria-label="Monto Transferencia"]',
  (e) => e.value,
);
check(montoTransf === "30900", `«Agregar medio de pago» precarga el restante: ${montoTransf}`);
await owner.type('dialog[open] input[aria-label="Referencia Transferencia"]', "OP-778899", {
  delay: 30,
});
await shot(owner, "02-mobile-cobro-pago-partido");
await clickTexto(owner, "dialog[@open]//button", "Confirmar venta");
await esperarTexto(owner, "confirmada", 20000);
await shot(owner, "03-mobile-venta-exitosa");
const venta1 = sql(`SELECT id FROM "Venta" WHERE estado = 'CONFIRMADA' ORDER BY numero LIMIT 1`);
const v1 = sql(
  `SELECT numero || '|' || "estadoPago" || '|' || total || '|' || "costoTotal" || '|' || "gananciaBruta" FROM "Venta" WHERE id = '${venta1}'`,
).split("|");
check(
  v1[1] === "PAGADA" && v1[2] === "40900.00",
  `venta #${v1[0]} CONFIRMADA · ${v1[1]} · total ${v1[2]}`,
);
check(
  v1[3] === "23500.00" && v1[4] === "17400.00",
  `costoTotal ${v1[3]} = 9500 + 9500 + 4500 · gananciaBruta ${v1[4]} = 40900 − 23500`,
);
const pagos1 = sql(
  `SELECT "medioPago" || ':' || monto || ':' || coalesce(referencia,'') FROM "PagoVenta" WHERE "ventaId" = '${venta1}' ORDER BY monto`,
).split("\n");
check(
  pagos1.join() === "EFECTIVO:10000.00:,TRANSFERENCIA:30900.00:OP-778899",
  `pagos: ${pagos1.join(" + ")}`,
);
check(
  sql(
    `SELECT count(*) FROM "MovimientoStock" WHERE tipo = 'VENTA' AND "referenciaTipo" = 'VENTA' AND "referenciaId" = '${venta1}'`,
  ) === "3",
  "3 movimientos VENTA con referencia",
);
const comp1 = sql(
  `SELECT tipo || ' ' || numero || '|' || coalesce("pdfUrl", '') FROM "Comprobante" WHERE "ventaId" = '${venta1}'`,
).split("|");
check(
  comp1[0] === "TICKET 1" && comp1[1]?.startsWith("/api/publico/archivos/comprobantes/"),
  `comprobante ${comp1[0]} con PDF en ${comp1[1]}`,
);
// Ticket (con sesión) y link público (sin sesión, el de WhatsApp).
const ticketHref = await owner.$eval("a[href^='/api/comprobantes/']", (a) =>
  a.getAttribute("href"),
);
const ticket = await owner.evaluate(async (h) => {
  const r = await fetch(h);
  const b = new Uint8Array(await r.arrayBuffer());
  return {
    status: r.status,
    tipo: r.headers.get("content-type"),
    inicio: String.fromCharCode(...b.slice(0, 5)),
  };
}, ticketHref);
check(
  ticket.status === 200 && ticket.tipo === "application/pdf" && ticket.inicio === "%PDF-",
  `«Ver ticket» → ${ticket.status} ${ticket.tipo}`,
);
const publico = await fetch(`${BASE}${comp1[1]}`);
check(
  publico.status === 200 && publico.headers.get("content-type") === "application/pdf",
  `link público del PDF SIN sesión → ${publico.status} ${publico.headers.get("content-type")}`,
);
const adivinado = await fetch(
  `${BASE}/api/publico/archivos/comprobantes/comprobante-1-${"0".repeat(48)}.pdf`,
);
check(adivinado.status === 404, `una clave inventada → ${adivinado.status}`);
const wa = await owner.$eval("a[href^='https://wa.me/']", (a) => a.getAttribute("href"));
const textoWa = decodeURIComponent(wa.split("text=")[1] ?? "");
check(
  textoWa.includes(`Venta #${v1[0]}`) && textoWa.includes(`${BASE}${comp1[1]}`),
  `WhatsApp: «${textoWa.replace(/\n/g, " / ")}»`,
);

// Guardo el ticket para verlo.
const pdf = await owner.evaluate(async (h) => {
  const b = new Uint8Array(await (await fetch(h)).arrayBuffer());
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}, ticketHref);
(await import("node:fs")).writeFileSync(
  path.join(SHOTS, "ticket-venta-1.pdf"),
  Buffer.from(pdf, "base64"),
);

// =============================================================================
console.log("\n   Stock insuficiente: la fila se marca y no deja cobrar");
await clickTexto(owner, "button", "Nueva venta");
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD.grape);
await owner.waitForSelector('input[aria-label="Cantidad de Ignite V80 — Grape Ice"]');
await escribir(owner, 'input[aria-label="Cantidad de Ignite V80 — Grape Ice"]', "10");
await owner.evaluate(() => document.activeElement?.blur());
await owner.waitForSelector("li[data-sin-stock]");
const cobrarDeshabilitado = await owner.$eval(
  "xpath/.//button[normalize-space(.)='Cobrar']",
  (b) => b.disabled,
);
check(
  cobrarDeshabilitado,
  `10 de Grape Ice (hay ${sql(`SELECT cantidad FROM "Stock" s JOIN "Variante" v ON v.id = s."varianteId" WHERE v.nombre = 'Grape Ice' AND s."depositoId" = '${G1}'`)}) → fila en rojo y «Cobrar» deshabilitado`,
);
await shot(owner, "04-mobile-pos-sin-stock");
await clickTexto(owner, "button", "Vaciar");

// =============================================================================
console.log("\n3) Fiado desde el POS a un cliente con límite (Martín Gómez, $50.000)");
await clickSelector(owner, 'button[aria-label="Elegir cliente (opcional)"]');
await owner.type('dialog[open] input[aria-label="Buscar cliente"]', "Martín", { delay: 90 }); // ritmo humano
await owner.waitForSelector("xpath/.//dialog[@open]//button[contains(., 'Martín Gómez')]", {
  visible: true,
});
await clickTexto(owner, "dialog[@open]//button", "Martín Gómez");
await owner.waitForFunction(() => !document.querySelector("dialog[open]"));
await owner.evaluate(() => document.activeElement?.blur());
await pistola(owner, COD.mango);
await pistola(owner, COD.frutilla);
await owner.waitForFunction(
  () => document.querySelectorAll('ul[aria-label="Productos de la venta"] > li').length === 2,
);
await clickTexto(owner, "button", "Cobrar");
await owner.waitForSelector('dialog[open] input[aria-label="Efectivo recibido"]', {
  visible: true,
});
await escribir(owner, 'dialog[open] input[aria-label="Efectivo recibido"]', "10000");
await owner.waitForSelector("xpath/.//dialog[@open]//button[contains(., 'Vender fiado')]", {
  visible: true,
});
await shot(owner, "05-mobile-cobro-fiado");
await clickTexto(owner, "dialog[@open]//button", "Vender fiado");
await esperarTexto(owner, "en la cuenta de Martín Gómez", 20000);
const martin = sql(`SELECT id FROM "Cliente" WHERE documento = '30111222'`);
const fiado = sql(
  `SELECT id || '|' || "estadoPago" || '|' || "saldoPendiente" FROM "Venta" WHERE "clienteId" = '${martin}' ORDER BY numero DESC LIMIT 1`,
).split("|");
check(
  fiado[1] === "PARCIAL" && fiado[2] === "22000.00",
  `venta fiada: ${fiado[1]}, saldoPendiente ${fiado[2]}`,
);
check(
  sql(`SELECT "saldoDeudor" FROM "Cliente" WHERE id = '${martin}'`) === "22000.00",
  "cliente.saldoDeudor 22000.00",
);
await shot(owner, "06-mobile-venta-fiada");
await clickTexto(owner, "button", "Nueva venta");

// =============================================================================
console.log("\n   Ficha del cliente: cuenta corriente y pago a cuenta");
await ir(owner, `/clientes/${martin}?tab=cuenta`);
await esperarTexto(owner, "Saldo $");
await shot(owner, "07-mobile-cliente-cuenta-corriente");
await clickTexto(owner, "button", "Registrar pago a cuenta");
await owner.waitForSelector("dialog[open] input[inputmode='decimal']", { visible: true });
await escribir(owner, "dialog[open] input[inputmode='decimal']", "12000");
await clickTexto(owner, "dialog[@open]//button", "Registrar pago");
await owner.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 15000 });
check(
  sql(`SELECT "saldoDeudor" FROM "Cliente" WHERE id = '${martin}'`) === "10000.00",
  "pago a cuenta de 12000 → debe 10000",
);

// =============================================================================
console.log("\n5) Anular la venta fiada desde su detalle");
await ir(owner, `/ventas/${fiado[0]}`);
await clickTexto(owner, "button", "Anular venta");
await owner.waitForSelector("dialog[open] textarea", { visible: true });
await owner.type("dialog[open] textarea", "Se cargó por error", { delay: 20 });
await clickTexto(owner, "dialog[@open]//button", "Anular venta");
await esperarTexto(owner, "Anulada por");
const anulada = sql(
  `SELECT v.estado || '|' || c.estado || '|' || (SELECT count(*) FROM "PagoVenta" p WHERE p."ventaId" = v.id AND NOT p.anulado) FROM "Venta" v JOIN "Comprobante" c ON c."ventaId" = v.id WHERE v.id = '${fiado[0]}'`,
).split("|");
check(
  anulada.join() === "ANULADA,ANULADO,0",
  `venta ${anulada[0]}, comprobante ${anulada[1]}, pagos vigentes ${anulada[2]}`,
);
check(
  sql(`SELECT "saldoDeudor" FROM "Cliente" WHERE id = '${martin}'`) === "0.00",
  "saldoDeudor revertido a 0",
);
check(
  sql(
    `SELECT count(*) FROM "MovimientoStock" WHERE tipo = 'DEVOLUCION_CLIENTE' AND "referenciaId" = '${fiado[0]}'`,
  ) === "2",
  "2 movimientos DEVOLUCION_CLIENTE",
);
await shot(owner, "08-mobile-venta-anulada");

// =============================================================================
console.log("\n4) Devolución parcial desde el detalle de la venta #1");
const stockMango = () =>
  Number(
    sql(
      `SELECT cantidad FROM "Stock" s JOIN "Variante" v ON v.id = s."varianteId" WHERE v.nombre = 'Mango Ice' AND s."depositoId" = '${G1}'`,
    ),
  );
const antesDev = stockMango();
await ir(owner, `/ventas/${venta1}`);
await clickTexto(owner, "button", "Devolución parcial");
await owner.waitForSelector('dialog[open] input[aria-label="Devolver de Ignite V80 — Mango Ice"]', {
  visible: true,
});
await escribir(owner, 'dialog[open] input[aria-label="Devolver de Ignite V80 — Mango Ice"]', "1");
await owner.type("dialog[open] textarea", "Venía fallado", { delay: 20 });
await shot(owner, "09-mobile-devolucion");
await clickTexto(owner, "dialog[@open]//button", "Registrar devolución");
await esperarTexto(owner, "Devolución #1");
const dev = sql(
  `SELECT total || '|' || "reintegroMonto" || '|' || "reintegroMedioPago" FROM "Devolucion" WHERE "ventaId" = '${venta1}'`,
).split("|");
check(
  dev.join() === "16000.00,16000.00,EFECTIVO",
  `devolución: total ${dev[0]}, reintegro ${dev[1]} en ${dev[2]}`,
);
check(stockMango() === antesDev + 1, `stock Mango ${antesDev} → ${stockMango()}`);
check(
  sql(
    `SELECT "cantidadDevuelta" FROM "VentaItem" vi JOIN "Variante" v ON v.id = vi."varianteId" WHERE vi."ventaId" = '${venta1}' AND v.nombre = 'Mango Ice'`,
  ) === "1",
  "cantidadDevuelta 1",
);
await shot(owner, "10-mobile-detalle-venta");

// =============================================================================
console.log("\n   Hub /escanear: el modo Vender lleva al POS con el depósito");
await ir(owner, `/escanear?deposito=${G1}`);
await clickTexto(owner, "button", "Vender");
await owner.waitForFunction(() => location.pathname === "/ventas/nueva", { timeout: 10000 });
check(
  new URL(owner.url()).searchParams.get("deposito") === G1,
  `→ ${new URL(owner.url()).pathname}?deposito=Galpón 1`,
);

// =============================================================================
console.log("\n9) POS en 1440px: atajos F2 / F9 y cobro inline con vuelto");
const desk = await sesion(browser, DESKTOP);
await login(desk, "dueno1@negocio.com", "DuenoUno2026");
await ir(desk, `/ventas/nueva?deposito=${G1}`);
await desk.keyboard.press("F2");
const foco = await desk.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check(foco === "Buscar producto", `F2 → foco en «${foco}»`);
await desk.keyboard.type("cool", { delay: 80 });
await desk.waitForSelector(
  "xpath/.//ul[@aria-label='Resultados']//button[contains(., 'Cool Mint')]",
  { visible: true },
);
await clickTexto(desk, "ul[@aria-label='Resultados']//button", "Cool Mint");
await desk.waitForSelector('section[aria-label="Cobro"]', { visible: true });
await desk.keyboard.press("F9");
await esperar(300);
const focoCobro = await desk.evaluate(() => document.activeElement?.getAttribute("aria-label"));
check(focoCobro === "Efectivo recibido", `F9 → foco en «${focoCobro}» (cobro inline, sin Sheet)`);
await desk.keyboard.type("20000", { delay: 60 });
await desk.waitForSelector('[data-testid="vuelto"]');
const vuelto = await desk.$eval('[data-testid="vuelto"]', (e) => e.textContent);
check(/5\.500/.test(vuelto), `recibe $20.000 por $14.500 → vuelto ${vuelto}`);
await shot(desk, "11-desktop-pos-cobro-inline");
await clickTexto(desk, "button", "Confirmar venta");
await esperarTexto(desk, "Vuelto: $");
const pagoEf = sql(
  `SELECT p.monto FROM "PagoVenta" p JOIN "Venta" v ON v.id = p."ventaId" ORDER BY v.numero DESC LIMIT 1`,
);
check(
  pagoEf === "14500.00",
  `se registró el efectivo aplicado (${pagoEf}), no el recibido: el vuelto no se persiste`,
);
await shot(desk, "12-desktop-venta-exitosa-vuelto");
for (const [ruta, nombre] of [
  ["/ventas", "13-desktop-ventas-listado"],
  [`/ventas/${venta1}`, "14-desktop-venta-detalle"],
  ["/clientes", "15-desktop-clientes"],
  [`/clientes/${martin}?tab=cuenta`, "16-desktop-cuenta-corriente"],
  ["/configuracion/ventas", "17-desktop-config-ventas"],
]) {
  await ir(desk, ruta);
  await shot(desk, nombre);
}
for (const [ruta, nombre] of [
  ["/ventas", "18-mobile-ventas-listado"],
  ["/clientes", "19-mobile-clientes"],
]) {
  await ir(owner, ruta);
  await shot(owner, nombre);
}

// =============================================================================
console.log(
  "\n7) Empleado con «crear» sin «editar»: sin descuento, sin precio editable, sin fiado",
);
const emp = await sesion(browser, MOBILE);
await login(emp, "empleado@negocio.com", "Empleado2026");
await ir(emp, `/ventas/nueva?deposito=${G1}&cliente=${martin}`);
await emp.evaluate(() => document.activeElement?.blur());
await pistola(emp, COD.cargador);
await emp.waitForSelector('ul[aria-label="Productos de la venta"] > li');
check(
  (await emp.$('input[aria-label^="Precio de"]')) === null,
  "sin input de precio en el carrito",
);
await clickTexto(emp, "button", "Cobrar");
await emp.waitForSelector('dialog[open] input[aria-label="Efectivo recibido"]', { visible: true });
await escribir(emp, 'dialog[open] input[aria-label="Efectivo recibido"]', "1000");
await esperar(300);
const textoCobro = await emp.$eval("dialog[open]", (d) => d.innerText);
check(
  !textoCobro.includes("Descuento") && !textoCobro.includes("Vender fiado"),
  "el cobro no muestra descuento ni «Vender fiado» (aunque el cliente tenga límite)",
);
await shot(emp, "20-mobile-empleado-cobro");
await emp.keyboard.press("Escape");
const cargadorId = sql(`SELECT id FROM "Variante" WHERE "codigoBarras" = '${COD.cargador}'`);
const forzadoDesc = await accion(emp, "venderAction", {
  venta: {
    depositoId: G1,
    items: [{ varianteId: cargadorId, cantidad: 1 }],
    descuentoGlobal: { tipo: "porcentaje", valor: 50 },
  },
  pagos: [{ medioPago: "EFECTIVO", monto: 4450 }],
  redondearA: 0,
});
check(
  forzadoDesc.includes('"FORBIDDEN"'),
  `Server Action forzada con descuento → ${forzadoDesc.match(/"message":"[^"]+"/)?.[0]}`,
);
const forzadoPrecio = await accion(emp, "venderAction", {
  venta: { depositoId: G1, items: [{ varianteId: cargadorId, cantidad: 1, precioUnitario: 1 }] },
  pagos: [{ medioPago: "EFECTIVO", monto: 1 }],
  redondearA: 0,
});
check(
  forzadoPrecio.includes('"FORBIDDEN"'),
  `…con precio manual → ${forzadoPrecio.match(/"message":"[^"]+"/)?.[0]}`,
);
const forzadoFiado = await accion(emp, "venderAction", {
  venta: { depositoId: G1, clienteId: martin, items: [{ varianteId: cargadorId, cantidad: 1 }] },
  pagos: [{ medioPago: "EFECTIVO", monto: 1000 }],
  redondearA: 0,
});
check(
  forzadoFiado.includes('"FORBIDDEN"'),
  `…fiando → ${forzadoFiado.match(/"message":"[^"]+"/)?.[0]}`,
);
const ok = await accion(emp, "venderAction", {
  venta: { depositoId: G1, items: [{ varianteId: cargadorId, cantidad: 1 }] },
  pagos: [{ medioPago: "EFECTIVO", monto: 8900 }],
  redondearA: 0,
});
check(ok.includes('"ok":true'), "…y la venta normal al precio de lista sí pasa");
const anularEmp = await accion(emp, "anularVentaAction", {
  ventaId: venta1,
  motivo: "no debería poder",
});
check(anularEmp.includes('"FORBIDDEN"'), "anular una venta sin «eliminar» → FORBIDDEN");
await ir(emp, "/configuracion/ventas");
check(
  new URL(emp.url()).pathname === "/sin-acceso",
  `/configuracion/ventas (solo dueño) → ${new URL(emp.url()).pathname}`,
);

await browser.close();
console.log(
  estado.fallos === 0 ? "\nE2E VENTAS OK ✅" : `\n${estado.fallos} verificación(es) fallaron ❌`,
);
process.exit(estado.fallos === 0 ? 0 : 1);
