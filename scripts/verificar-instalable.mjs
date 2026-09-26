/**
 * ¿Chrome considera la app INSTALABLE? (manifest válido, íconos, service worker
 * controlando, HTTPS/localhost). Usa Page.getInstallabilityErrors del
 * DevTools Protocol, lo mismo que decide si aparece "Instalar app".
 * Uso: node scripts/verificar-instalable.mjs [http://localhost:3100]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3100";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const p = await b.newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
// El service worker tiene que estar activo y controlando.
await p.evaluate(() => navigator.serviceWorker.ready);
await p.reload({ waitUntil: "networkidle0" });
const cdp = await p.createCDPSession();
const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
const manifest = await cdp.send("Page.getAppManifest");
// Chrome nuevo dejó de mandar `data` en getAppManifest: se lee el manifest que el navegador resolvió.
const m = manifest.data
  ? JSON.parse(manifest.data)
  : await p.evaluate(async (u) => (await fetch(u)).json(), manifest.url);
console.log(
  `Manifest: ${manifest.url} · name="${m.name}" · display=${m.display} · ${m.icons?.length ?? 0} íconos · ${m.shortcuts?.length ?? 0} shortcuts · ${m.screenshots?.length ?? 0} screenshots`,
);
console.log(
  `Service worker: ${await p.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "ninguno")}`,
);
if (installabilityErrors.length) {
  console.log("✘ NO instalable:", installabilityErrors.map((e) => e.errorId).join(", "));
  process.exitCode = 1;
} else console.log("✔ Instalable: Chrome no reporta errores de instalabilidad");
await b.close();
