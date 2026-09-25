/**
 * E2E del Prompt 6 (dashboard, reportes, exportaciones, gastos, caja y
 * notificaciones) por la UI real, con Chrome headless.
 *
 * Requiere el build de producción contra una DB con seed + seed-demo:
 *   scripts/db-descartable.sh gestion_demo --demo
 *   pnpm build && DATABASE_URL=…/gestion_demo pnpm start -p 3457
 *   E2E_DB=gestion_demo pnpm test:e2e:reportes
 * Screenshots y archivos exportados en verificacion/prompt6/ (ignorado por git).
 */
import fs from "node:fs";
import path from "node:path";

import {
  BASE,
  clickTexto,
  crearVerificador,
  DESKTOP,
  esperarTexto,
  ir,
  lanzar,
  login,
  MOBILE,
  sql,
} from "./e2e-comun.mjs";

const SHOTS = path.resolve(process.argv[2] ?? "verificacion/prompt6");
const { check, sesion, shot, estado } = crearVerificador(SHOTS);
const browser = await lanzar();

/** Descarga con la cookie de la página (fetch dentro del navegador). */
async function descargar(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const b = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000)
      s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return {
      status: r.status,
      tipo: r.headers.get("content-type"),
      disposicion: r.headers.get("content-disposition"),
      base64: btoa(s),
    };
  }, url);
}

// =============================================================================
console.log("\n1) Dashboard del dueño — 1440 px y 375 px");
const owner = await sesion(browser, DESKTOP);
await login(owner, "dueno1@negocio.com", "DuenoUno2026");
await ir(owner, "/?periodo=mes");
await owner.waitForSelector('section[aria-label="Indicadores"]');
await owner.waitForFunction(() => !document.querySelector(".animate-pulse"), { timeout: 20000 });
const kpis = await owner.$$eval('section[aria-label="Indicadores"] > div', (d) =>
  d.map((x) => x.innerText.replace(/\s+/g, " ")),
);
check(
  kpis.length === 6,
  `6 KPIs para el dueño: ${kpis.map((k) => k.split(" ").slice(0, 3).join(" ")).join(" | ")}`,
);
check(
  kpis.every((k) => /vs\./.test(k)),
  "cada KPI muestra la variación contra el período anterior",
);
for (const t of [
  "Ventas y ganancia bruta",
  "Medios de pago",
  "Stock por galpón",
  "Top 10 sabores",
  "Sabores sin ventas",
  "Caja",
  "Por vendedor",
  "Cuentas por cobrar",
  "Pendientes",
]) {
  check(
    await owner.evaluate(
      (x) => [...document.querySelectorAll("h2")].some((h) => h.textContent.includes(x)),
      t,
    ),
    `tarjeta «${t}»`,
  );
}
check(
  await owner.evaluate(() => document.body.innerText.includes("Café Tabaco")),
  "sabores lentos: Lost Mary — Café Tabaco (stock sin ventas)",
);
check(
  (await owner.$$(".recharts-surface")).length >= 3,
  "gráficos renderizados (área, donut, barras)",
);
await shot(owner, "01-desktop-dashboard");
await owner.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot(owner, "02-desktop-dashboard-abajo");

await clickTexto(owner, "button", "Mes anterior");
await owner.waitForFunction(() => location.search.includes("periodo=mes-anterior"));
await owner.waitForFunction(() => document.body.innerText.includes("Mes anterior ("), {
  timeout: 15000,
});
await owner.waitForFunction(() => !document.querySelector(".animate-pulse"), { timeout: 20000 });
check(true, "selector «Mes anterior» persiste en la URL");
await shot(owner, "03-desktop-dashboard-mes-anterior");

const movil = await sesion(browser, MOBILE);
await login(movil, "dueno1@negocio.com", "DuenoUno2026");
await ir(movil, "/?periodo=mes");
await movil.waitForFunction(() => !document.querySelector(".animate-pulse"), { timeout: 20000 });
await shot(movil, "04-mobile-dashboard");
await movil.setViewport({ ...MOBILE, height: 3800 });
await shot(movil, "05-mobile-dashboard-completo");
await movil.setViewport(MOBILE);

// =============================================================================
console.log("\n2) Reportes: índice, reporte 3 (stock) y exportación PDF + Excel");
await ir(owner, "/reportes");
const cards = await owner.$$eval("main ul > li", (l) => l.length);
check(cards === 11, `el dueño ve los 11 reportes (${cards})`);
await shot(owner, "06-desktop-reportes");
await ir(owner, "/reportes/stock");
await esperarTexto(owner, "Stock por producto, sabor y depósito");
await shot(owner, "07-desktop-reporte-stock");
const pdf = await descargar(owner, "/api/reportes/stock?formato=pdf");
check(
  pdf.status === 200 && pdf.tipo === "application/pdf",
  `PDF del reporte 3: ${pdf.status} ${pdf.tipo}`,
);
fs.writeFileSync(path.join(SHOTS, "reporte-3-stock.pdf"), Buffer.from(pdf.base64, "base64"));
const xlsx = await descargar(owner, "/api/reportes/stock?formato=xlsx");
check(
  xlsx.status === 200 && xlsx.tipo?.includes("spreadsheetml"),
  `Excel del reporte 3: ${xlsx.status}`,
);
fs.writeFileSync(path.join(SHOTS, "reporte-3-stock.xlsx"), Buffer.from(xlsx.base64, "base64"));
for (const slug of [
  "ventas",
  "ganancias",
  "rotacion",
  "valorizacion",
  "movimientos",
  "compras",
  "gastos",
  "cuentas-por-cobrar",
  "cierres-de-caja",
  "resumen-mensual",
]) {
  await ir(owner, `/reportes/${slug}`);
  check(
    await owner.evaluate(() => !document.body.innerText.includes("Ocurrió un error")),
    `/reportes/${slug} carga`,
  );
}
await ir(owner, "/reportes/resumen-mensual?periodo=mes-anterior");
await shot(owner, "08-desktop-resumen-mensual");
const resumenPdf = await descargar(
  owner,
  "/api/reportes/resumen-mensual?formato=pdf&periodo=mes-anterior",
);
fs.writeFileSync(
  path.join(SHOTS, "reporte-11-resumen-mensual.pdf"),
  Buffer.from(resumenPdf.base64, "base64"),
);
await ir(movil, "/reportes/ventas");
await shot(movil, "09-mobile-reporte-ventas");

// =============================================================================
console.log("\n3) Gastos y caja (dueño)");
await ir(owner, "/gastos");
await esperarTexto(owner, "Gastos recurrentes del mes pasado");
check(
  await owner.evaluate(() => document.body.innerText.includes("Internet Galpón 2")),
  "recordatorio: «Internet Galpón 2» sin cargar este mes",
);
await shot(owner, "10-desktop-gastos");
await clickTexto(owner, "button", "Nuevo gasto");
await owner.waitForSelector("#form-gasto");
await shot(owner, "11-desktop-gasto-nuevo");
await owner.keyboard.press("Escape");
await ir(movil, "/caja");
await shot(movil, "12-mobile-caja");
await clickTexto(movil, "button", "Cerrar caja");
await movil.waitForSelector('ul[aria-label="Conteo de billetes"]');
await movil.type('input[aria-label="Billetes de 10000"]', "3");
await movil.type('input[aria-label="Billetes de 2000"]', "2");
check(
  (await movil.$eval('[data-testid="contado"]', (e) => e.textContent)).includes("34.000"),
  "el contador de billetes suma solo ($ 34.000)",
);
await shot(movil, "13-mobile-arqueo");
await movil.keyboard.press("Escape");
await ir(owner, "/caja?diferencia=1");
await shot(owner, "14-desktop-caja-historico");

// =============================================================================
console.log("\n4) Empleado con REPORTES y sin FINANZAS");
const emp = sql(`SELECT id FROM "Usuario" WHERE email = 'empleado@negocio.com'`);
sql(
  `INSERT INTO "PermisoUsuario" ("id","usuarioId","modulo","puedeVer","updatedAt") VALUES ('e2e-rep-${emp}', '${emp}', 'REPORTES', true, now()) ON CONFLICT ("usuarioId","modulo") DO UPDATE SET "puedeVer" = true`,
);
sql(`DELETE FROM "PermisoUsuario" WHERE "usuarioId" = '${emp}' AND "modulo" = 'FINANZAS'`);
const empleado = await sesion(browser, DESKTOP);
await login(empleado, "empleado@negocio.com", "Empleado2026");
await ir(empleado, "/reportes");
const visibles = await empleado.$$eval("main ul > li", (l) =>
  l.map((x) => x.innerText.split("\n")[0]),
);
check(
  JSON.stringify(visibles) === JSON.stringify(["1", "3", "4", "6", "10"]),
  `ve los reportes ${visibles.join(", ")} (esperado 1, 3, 4, 6, 10)`,
);
await shot(empleado, "15-empleado-reportes");
for (const slug of ["ventas", "stock", "rotacion", "movimientos", "cierres-de-caja"]) {
  await ir(empleado, `/reportes/${slug}`);
  const texto = await empleado.evaluate(() => document.body.innerText);
  check(
    !/Ganancia|Costo|a costo|Valor a costo|Margen/i.test(texto),
    `/reportes/${slug} sin columnas de costo ni ganancia`,
  );
}
await ir(empleado, "/reportes/stock");
await shot(empleado, "16-empleado-reporte-stock");
for (const slug of ["ganancias", "valorizacion", "compras", "resumen-mensual"]) {
  const r = await descargar(empleado, `/api/reportes/${slug}?formato=pdf`);
  const r2 = await descargar(empleado, `/api/reportes/${slug}?formato=xlsx`);
  check(
    r.status === 403 && r2.status === 403,
    `exportar «${slug}» (PDF y Excel) → ${r.status} / ${r2.status}`,
  );
}
const ok = await descargar(empleado, "/api/reportes/stock?formato=xlsx");
check(ok.status === 200, `exportar «stock» sí se permite (${ok.status})`);
await ir(empleado, "/reportes/ganancias");
check(new URL(empleado.url()).pathname === "/sin-acceso", "/reportes/ganancias → /sin-acceso");
await ir(empleado, "/?periodo=mes");
await empleado.waitForFunction(() => !document.querySelector(".animate-pulse"), { timeout: 20000 });
const dashEmp = await empleado.evaluate(() => document.body.innerText);
check(!/Ganancia bruta|Ganancia neta/.test(dashEmp), "dashboard del empleado sin ganancias");
check(dashEmp.includes("Por vendedor"), "con REPORTES ve el negocio entero (por vendedor)");
await shot(empleado, "17-empleado-dashboard");

// Sin REPORTES: solo lo propio.
sql(`DELETE FROM "PermisoUsuario" WHERE "usuarioId" = '${emp}' AND "modulo" = 'REPORTES'`);
await ir(empleado, "/?periodo=mes");
await empleado.waitForFunction(() => !document.querySelector(".animate-pulse"), { timeout: 20000 });
const propio = await empleado.evaluate(() => document.body.innerText);
check(
  /mis ventas/i.test(propio) && !/por vendedor/i.test(propio),
  "sin REPORTES: «Mis ventas» y sin «por vendedor»",
);
await shot(empleado, "18-empleado-sin-reportes-dashboard");

// =============================================================================
console.log("\n5) Notificaciones: cron protegido + campana");
const sinSecreto = await fetch(`${BASE}/api/cron/alertas`);
check(sinSecreto.status === 401, `cron sin secreto → ${sinSecreto.status}`);
const secreto = fs.readFileSync(".env", "utf8").match(/CRON_SECRET="?([^"\n]+)/)?.[1];
const cron = await fetch(`${BASE}/api/cron/alertas`, {
  headers: { Authorization: `Bearer ${secreto}` },
});
const cuerpo = await cron.json();
check(
  cron.status === 200 && cuerpo.ok,
  `cron con secreto → ${cron.status} ${JSON.stringify(cuerpo.data)}`,
);
await ir(owner, "/");
const campana = await owner.$eval('a[href="/notificaciones"]', (a) => a.getAttribute("aria-label"));
check(/sin leer/.test(campana ?? ""), `campana: «${campana}»`);
await ir(owner, "/notificaciones");
await shot(owner, "19-desktop-notificaciones");
await ir(movil, "/notificaciones");
await shot(movil, "20-mobile-notificaciones");

await browser.close();
console.log(estado.fallos ? `\n${estado.fallos} FALLO(S)` : "\nTODO OK");
process.exit(estado.fallos ? 1 : 0);
